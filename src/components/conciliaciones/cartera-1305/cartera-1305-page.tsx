"use client";

import * as React from "react";
import { Check, ChevronRight, Download, LoaderCircle, Search, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { descargarExcel1305 } from "@/lib/conciliaciones/cartera-1305-excel";
import {
  MAX_IDS_TERCEROS,
  calcular,
  corteDeMes,
  deTupla,
  negativos as armarNegativos,
  tipoLabel,
  tramosAplicaciones,
  tramosPartidas,
  unirPartidas,
  type Partida,
  type PartidaTupla,
  type ResumenCartera,
  type Tercero,
  type TerceroNegativo,
  type Tramo,
} from "@/lib/conciliaciones/cartera-1305-shared";
import type { Subsidiaria } from "@/lib/conciliaciones/asientos-shared";
import { cn } from "@/lib/utils";

const SIIGO_SAS = "SIIGO S.A.S";
/** Tramos a la vez: cada uno abre hasta 2 páginas en NetSuite; más de esto dispara 429. */
const EN_PARALELO = 3;
const REINTENTOS = 2;
const POR_PAGINA = 50;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const fmtEntero = new Intl.NumberFormat("es-CO");
const fmtPesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtFecha = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

const CARD = "flex flex-col rounded-lg border border-border bg-card p-5 shadow-sm h-short:p-4";

function hoyBogota(): string {
  return new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** Mes anterior al actual: el que normalmente se cierra. */
function mesAnterior(): string {
  const [y, m] = hoyBogota().split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nombreMes(periodo: string): string {
  const [y, m] = periodo.split("-");
  return `${MESES[Number(m) - 1] ?? ""} ${y}`;
}

type EstadoTramo = "pendiente" | "corriendo" | "listo" | "error";

interface Paso {
  clave: string;
  grupo: "Partidas abiertas" | "Aplicaciones posteriores" | "Nombres de terceros";
  etiqueta: string;
  estado: EstadoTramo;
  filas?: number;
}

interface Resultado {
  corte: string;
  subsidiaria: string;
  resumen: ResumenCartera;
  negativos: TerceroNegativo[];
  generado: Date;
  duracionMs: number;
}

async function pedir<T>(body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  let ultimo: Error | null = null;
  for (let intento = 0; intento <= REINTENTOS; intento++) {
    try {
      const res = await fetch("/api/conciliaciones/cartera-1305", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      const payload = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
      if (res.ok && payload) return payload;
      ultimo = new Error(payload?.error ?? `NetSuite respondió ${res.status}.`);
      // Errores de validación o permisos no mejoran reintentando.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      ultimo = err as Error;
    }
  }
  throw ultimo ?? new Error("No se pudo consultar NetSuite.");
}

/** Corre tareas con un máximo de `n` a la vez. */
async function enParalelo<T>(tareas: (() => Promise<T>)[], n: number): Promise<T[]> {
  const out: T[] = new Array(tareas.length);
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tareas.length) }, async () => {
      while (siguiente < tareas.length) {
        const i = siguiente++;
        out[i] = await tareas[i]!();
      }
    }),
  );
  return out;
}

interface Cartera1305PageProps {
  subsidiarias: Subsidiaria[];
  errorSubsidiarias: string | null;
}

export function Cartera1305Page({ subsidiarias, errorSubsidiarias }: Cartera1305PageProps) {
  const [periodo, setPeriodo] = React.useState(mesAnterior);
  const [subsidiariaId, setSubsidiariaId] = React.useState(
    () => subsidiarias.find((s) => s.nombre === SIIGO_SAS)?.id ?? subsidiarias[0]?.id ?? "",
  );
  const [pasos, setPasos] = React.useState<Paso[]>([]);
  const [corriendo, setCorriendo] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resultado, setResultado] = React.useState<Resultado | null>(null);
  const [inicio, setInicio] = React.useState<number | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const hoy = hoyBogota();
  const periodoValido = /^\d{4}-(0[1-9]|1[0-2])$/.test(periodo) && corteDeMes(periodo) < hoy;
  const subsidiaria = subsidiarias.find((s) => s.id === subsidiariaId) ?? null;
  const puedeGenerar = !corriendo && periodoValido && !!subsidiaria;

  const marcar = React.useCallback((clave: string, cambio: Partial<Paso>) => {
    setPasos((ps) => ps.map((p) => (p.clave === clave ? { ...p, ...cambio } : p)));
  }, []);

  function cancelar() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  async function generar() {
    if (!puedeGenerar || !subsidiaria) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const { signal } = controller;
    const corte = corteDeMes(periodo);
    const tAbiertas = tramosPartidas(corte);
    const tAplicaciones = tramosAplicaciones(corte, hoy);
    const clave = (g: string, t: Tramo) => `${g}:${t.desde ?? ""}:${t.hasta}`;

    setPasos([
      ...tAbiertas.map((t) => ({ clave: clave("a", t), grupo: "Partidas abiertas" as const, etiqueta: t.etiqueta, estado: "pendiente" as const })),
      ...tAplicaciones.map((t) => ({ clave: clave("p", t), grupo: "Aplicaciones posteriores" as const, etiqueta: t.etiqueta, estado: "pendiente" as const })),
      { clave: "terceros", grupo: "Nombres de terceros", etiqueta: "Terceros negativos", estado: "pendiente" },
    ]);
    setResultado(null);
    setError(null);
    setCorriendo(true);
    const t0 = Date.now();
    setInicio(t0);

    const tramo = (accion: "abiertas" | "aplicaciones", g: string, t: Tramo) => async () => {
      marcar(clave(g, t), { estado: "corriendo" });
      try {
        const { partidas } = await pedir<{ partidas: PartidaTupla[] }>(
          { accion, subsidiariaId: subsidiaria.id, corte, desde: t.desde, hasta: t.hasta },
          signal,
        );
        marcar(clave(g, t), { estado: "listo", filas: partidas.length });
        return partidas.map(deTupla);
      } catch (err) {
        if ((err as Error).name !== "AbortError") marcar(clave(g, t), { estado: "error" });
        throw err;
      }
    };

    try {
      // Lo que trae más filas arranca primero: los meses recientes, luego las aplicaciones
      // posteriores y al final los años viejos (pocas filas, costo fijo de ~1 min).
      const recientes = tAbiertas.slice(0, 3);
      const viejos = tAbiertas.slice(3);
      const tareas = [
        ...recientes.map((t) => tramo("abiertas", "a", t)),
        ...tAplicaciones.map((t) => tramo("aplicaciones", "p", t)),
        ...viejos.map((t) => tramo("abiertas", "a", t)),
      ];
      const lotes = await enParalelo(tareas, EN_PARALELO);
      const nR = recientes.length;
      const nP = tAplicaciones.length;
      const aplicadas: Partida[] = lotes.slice(nR, nR + nP).flat();
      const abiertas: Partida[] = [...lotes.slice(0, nR), ...lotes.slice(nR + nP)].flat();

      const calc = calcular(unirPartidas(abiertas, aplicadas).values(), corte);

      marcar("terceros", { estado: "corriendo" });
      const mapa = new Map<string, Tercero>();
      for (let i = 0; i < calc.idsNegativos.length; i += MAX_IDS_TERCEROS) {
        const { terceros } = await pedir<{ terceros: Tercero[] }>(
          { accion: "terceros", ids: calc.idsNegativos.slice(i, i + MAX_IDS_TERCEROS) },
          signal,
        );
        for (const t of terceros) mapa.set(t.id, t);
      }
      marcar("terceros", { estado: "listo", filas: calc.idsNegativos.length });

      setResultado({
        corte,
        subsidiaria: subsidiaria.nombre,
        resumen: calc.resumen,
        negativos: armarNegativos(calc, mapa, corte),
        generado: new Date(),
        duracionMs: Date.now() - t0,
      });
      toast.success("Conciliación 1305 lista");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setPasos([]);
        return;
      }
      const msg = (err as Error).message || "No se pudo consultar NetSuite.";
      setError(msg);
      toast.error(msg);
    } finally {
      setCorriendo(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  return (
    <div className="flex flex-col gap-6 h-short:gap-4">
      <header className="flex min-w-0 flex-col gap-2 h-short:gap-1">
        <h1 className="text-base font-semibold tracking-tight text-foreground">Conciliación 1305</h1>
        <p className="max-w-3xl text-sm text-muted-foreground h-tiny:sr-only">
          Reconstruye la cartera de las cuentas 1305 a la fecha de corte, suma el saldo de cada tercero y lista los
          documentos de los terceros que quedan con saldo negativo. Las facturas de venta no se netean contra los pagos.
        </p>
      </header>

      <section aria-labelledby="c1305-parametros" className={cn(CARD, "gap-4")}>
        <h2 id="c1305-parametros" className="sr-only">
          Parámetros
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex w-52 flex-col gap-1.5">
            <label htmlFor="c1305-periodo" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Mes de corte
            </label>
            <Input
              id="c1305-periodo"
              type="month"
              value={periodo}
              max={mesAnterior()}
              onChange={(e) => {
                setPeriodo(e.target.value);
                setResultado(null);
              }}
              disabled={corriendo}
              aria-invalid={!periodoValido}
              className="font-mono tabular-nums"
            />
          </div>
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5 sm:max-w-80">
            <span id="c1305-subsidiaria" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Subsidiaria
            </span>
            <Select
              value={subsidiariaId}
              onValueChange={(v) => {
                setSubsidiariaId(v);
                setResultado(null);
              }}
              disabled={corriendo || subsidiarias.length === 0}
            >
              <SelectTrigger aria-labelledby="c1305-subsidiaria" className="w-full">
                <SelectValue placeholder={subsidiarias.length ? "Elige la subsidiaria" : "No disponible"} />
              </SelectTrigger>
              <SelectContent>
                {subsidiarias.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nombre}
                    {s.pais && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{s.pais}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {corriendo ? (
              <Button type="button" variant="outline" onClick={cancelar}>
                <X className="size-4" aria-hidden />
                Cancelar
              </Button>
            ) : null}
            <Button type="button" onClick={generar} disabled={!puedeGenerar}>
              {corriendo ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
              {corriendo ? "Consultando NetSuite…" : resultado ? "Generar de nuevo" : "Generar reporte"}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {errorSubsidiarias ? (
            <span className="text-destructive">NetSuite no respondió: {errorSubsidiarias}</span>
          ) : periodoValido ? (
            <>
              Corte al <span className="text-foreground">{fmtFecha(corteDeMes(periodo))}</span> ({nombreMes(periodo)}). Se
              consulta NetSuite en vivo; tarda unos 7 minutos.
            </>
          ) : (
            "Elige un mes ya cerrado."
          )}
        </p>
      </section>

      {pasos.length > 0 && (corriendo || error || !resultado) && (
        <Progreso pasos={pasos} inicio={inicio} corriendo={corriendo} error={error} />
      )}

      {resultado && <Resultados resultado={resultado} />}
    </div>
  );
}

function Progreso({
  pasos,
  inicio,
  corriendo,
  error,
}: {
  pasos: Paso[];
  inicio: number | null;
  corriendo: boolean;
  error: string | null;
}) {
  const [, tick] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    if (!corriendo) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [corriendo]);
  const listos = pasos.filter((p) => p.estado === "listo").length;
  const pct = Math.round((listos / pasos.length) * 100);
  const seg = inicio ? Math.floor((Date.now() - inicio) / 1000) : 0;
  const grupos = [...new Set(pasos.map((p) => p.grupo))];

  return (
    <section aria-label="Progreso de la consulta" className={cn(CARD, "gap-4")}>
      <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
        <p className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            {error ? (
              <span className="flex items-start gap-1.5 text-destructive">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </span>
            ) : (
              `Consultando NetSuite · ${listos} de ${pasos.length} consultas`
            )}
          </span>
          <span className="font-mono text-xs tabular-nums text-foreground">
            {Math.floor(seg / 60)}:{String(seg % 60).padStart(2, "0")}
          </span>
        </p>
        <div
          role="progressbar"
          aria-label="Consultas terminadas"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {grupos.map((g) => (
          <div key={g} className="flex min-w-0 flex-col gap-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</p>
            <ul className="flex flex-wrap gap-1.5">
              {pasos
                .filter((p) => p.grupo === g)
                .map((p) => (
                  <li
                    key={p.clave}
                    title={p.filas !== undefined ? `${fmtEntero.format(p.filas)} filas` : undefined}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs tabular-nums",
                      p.estado === "listo" && "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
                      p.estado === "corriendo" && "border-primary/40 bg-primary/5 text-foreground",
                      p.estado === "pendiente" && "border-border text-muted-foreground",
                      p.estado === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
                    )}
                  >
                    {p.estado === "listo" ? (
                      <Check className="size-3" aria-hidden />
                    ) : p.estado === "corriendo" ? (
                      <LoaderCircle className="size-3 animate-spin" aria-hidden />
                    ) : p.estado === "error" ? (
                      <TriangleAlert className="size-3" aria-hidden />
                    ) : null}
                    {p.etiqueta}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Resultados({ resultado }: { resultado: Resultado }) {
  const { negativos, resumen } = resultado;
  const [busqueda, setBusqueda] = React.useState("");
  const [pagina, setPagina] = React.useState(0);
  const [abiertos, setAbiertos] = React.useState<Set<string>>(new Set());
  const [descargando, setDescargando] = React.useState(false);

  const totalNeg = negativos.reduce((a, t) => a + t.saldo, 0);
  const docs = negativos.reduce((a, t) => a + t.lineas.length, 0);
  const sumaDocs = negativos.reduce((a, t) => a + t.lineas.reduce((b, l) => b + l.saldo, 0), 0);

  const q = busqueda.trim().toLowerCase();
  const filtrados = q
    ? negativos.filter((t) => t.tercero.nombre.toLowerCase().includes(q) || t.tercero.documento.includes(q) || t.lineas.some((l) => l.numero.toLowerCase().includes(q)))
    : negativos;
  const paginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const actual = Math.min(pagina, paginas - 1);
  const visibles = filtrados.slice(actual * POR_PAGINA, (actual + 1) * POR_PAGINA);

  async function descargar() {
    setDescargando(true);
    try {
      await descargarExcel1305({ subsidiaria: resultado.subsidiaria, corte: resultado.corte, generado: resultado.generado }, resumen, negativos);
    } catch {
      toast.error("No se pudo generar el Excel.");
    } finally {
      setDescargando(false);
    }
  }

  const alternar = (id: string) =>
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador etiqueta="Terceros con saldo negativo" valor={fmtEntero.format(negativos.length)} detalle={`de ${fmtEntero.format(resumen.terceros)} con cartera abierta`} />
        <Indicador etiqueta="Saldo negativo" valor={fmtPesos.format(totalNeg)} tono="negativo" detalle="suma del saldo de esos terceros" />
        <Indicador etiqueta="Documentos a revisar" valor={fmtEntero.format(docs)} detalle={`suman ${fmtPesos.format(sumaDocs)}`} />
        <Indicador etiqueta="Cartera 1305 al corte" valor={fmtPesos.format(resumen.carteraTotal)} detalle={`${fmtEntero.format(resumen.partidas)} partidas abiertas`} />
      </section>

      <section aria-labelledby="c1305-terceros" className={cn(CARD, "gap-4 p-0 h-short:p-0")}>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
          <div className="mr-auto flex min-w-0 flex-col">
            <h2 id="c1305-terceros" className="text-base font-semibold tracking-tight text-foreground">
              Terceros con saldo negativo
            </h2>
            <p className="text-xs text-muted-foreground">
              {resultado.subsidiaria} · corte al {fmtFecha(resultado.corte)} · {Math.round(resultado.duracionMs / 1000)} s en NetSuite
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={busqueda}
              onChange={(e) => {
                setBusqueda(e.target.value);
                setPagina(0);
              }}
              placeholder="Cliente, KS Documento o número"
              aria-label="Buscar tercero o documento"
              className="pl-8"
            />
          </div>
          <Button type="button" onClick={descargar} disabled={descargando}>
            {descargando ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            Descargar Excel
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="w-8 px-3 py-2" />
                <th className="w-3/5 px-3 py-2">Cliente</th>
                <th className="px-3 py-2">KS Documento</th>
                <th className="px-3 py-2 text-right">Documentos</th>
                <th className="px-5 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((t) => {
                const abierto = abiertos.has(t.tercero.id);
                return (
                  <React.Fragment key={t.tercero.id}>
                    <tr className="cursor-pointer border-b border-border/60 hover:bg-muted/40" onClick={() => alternar(t.tercero.id)}>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-expanded={abierto}
                          aria-label={`${abierto ? "Ocultar" : "Ver"} documentos de ${t.tercero.nombre}`}
                          className="flex size-5 items-center justify-center rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={(e) => {
                            e.stopPropagation();
                            alternar(t.tercero.id);
                          }}
                        >
                          <ChevronRight className={cn("size-4 transition-transform", abierto && "rotate-90")} aria-hidden />
                        </button>
                      </td>
                      <td className="max-w-0 truncate px-3 py-2 font-medium text-foreground" title={t.tercero.nombre}>
                        {t.tercero.nombre}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">{t.tercero.documento || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {t.lineas.length}
                        {t.facturas > 0 && <span className="ml-1 text-xs">+ {t.facturas} fact.</span>}
                      </td>
                      <td className="px-5 py-2 text-right font-mono tabular-nums text-rose-700 dark:text-rose-400">{fmtPesos.format(t.saldo)}</td>
                    </tr>
                    {abierto && (
                      <tr className="border-b border-border/60 bg-muted/30">
                        <td />
                        <td colSpan={4} className="px-3 pb-3 pt-1">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-muted-foreground">
                                <th className="py-1 pr-3 font-medium">Tipo</th>
                                <th className="py-1 pr-3 font-medium">Número</th>
                                <th className="py-1 pr-3 font-medium">Fecha</th>
                                <th className="py-1 pr-3 font-medium">Vence</th>
                                <th className="py-1 pr-3 text-right font-medium">Días</th>
                                <th className="py-1 pr-3 font-medium">Cuenta</th>
                                <th className="py-1 pr-2 text-right font-medium">Saldo</th>
                              </tr>
                            </thead>
                            <tbody>
                              {t.lineas.map((l) => (
                                <tr key={`${l.numero}-${l.fecha}-${l.saldo}`} className="border-t border-border/50">
                                  <td className="py-1 pr-3">{l.tipo}</td>
                                  <td className="py-1 pr-3 font-mono">{l.numero}</td>
                                  <td className="py-1 pr-3 tabular-nums">{fmtFecha(l.fecha)}</td>
                                  <td className="py-1 pr-3 tabular-nums">{fmtFecha(l.vence)}</td>
                                  <td className="py-1 pr-3 text-right tabular-nums">{l.diasVencido ?? "—"}</td>
                                  <td className="py-1 pr-3 font-mono">{l.cuenta}</td>
                                  <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtPesos.format(l.saldo)}</td>
                                </tr>
                              ))}
                              {t.facturas > 0 && (
                                <tr className="border-t border-border/50 text-muted-foreground">
                                  <td className="py-1 pr-3" colSpan={6}>
                                    {tipoLabel("CustInvc")}s abiertas ({t.facturas}), suman al saldo pero no se listan
                                  </td>
                                  <td className="py-1 pr-2 text-right font-mono tabular-nums">{fmtPesos.format(t.facturasSaldo)}</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-muted-foreground">
                    {negativos.length === 0 ? "Ningún tercero queda con saldo negativo a esta fecha." : "Nada coincide con la búsqueda."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filtrados.length > POR_PAGINA && (
          <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {fmtEntero.format(actual * POR_PAGINA + 1)}–{fmtEntero.format(Math.min((actual + 1) * POR_PAGINA, filtrados.length))} de{" "}
              {fmtEntero.format(filtrados.length)}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={actual === 0} onClick={() => setPagina(actual - 1)}>
                Anterior
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={actual >= paginas - 1} onClick={() => setPagina(actual + 1)}>
                Siguiente
              </Button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function Indicador({ etiqueta, valor, detalle, tono }: { etiqueta: string; valor: string; detalle: string; tono?: "negativo" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{etiqueta}</p>
      <p className={cn("truncate font-mono text-lg font-semibold tabular-nums", tono === "negativo" ? "text-rose-700 dark:text-rose-400" : "text-foreground")} title={valor}>
        {valor}
      </p>
      <p className="truncate text-xs text-muted-foreground" title={detalle}>
        {detalle}
      </p>
    </div>
  );
}

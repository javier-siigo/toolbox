"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Download, FileSpreadsheet, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { ComoUsar } from "@/components/tour/como-usar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Nivel } from "@/lib/auth/permisos-shared";
import { cn } from "@/lib/utils";
import { ordenColumnas, type CampoCatalogo, type Plantilla } from "@/lib/netsuite/campos";
import {
  filtroActivo,
  filtrosValidos,
  mismosFiltros,
  type Filtro,
} from "@/lib/netsuite/filtros";
import {
  MAX_DIAS_EXPORT,
  diasDelRango,
  etiquetaRango,
  mesesRecientes,
  validarRango,
} from "@/lib/netsuite/rango-fechas";

import { CamposCard, mismosIds } from "./campos-card";
import { FiltrosCard } from "./filtros-card";
import { TOUR_EXPORT_BANCOS } from "./tour";

type ExportState =
  | { status: "idle" }
  | { status: "processing"; startedAt: number; dias: number }
  | {
      status: "done";
      url: string;
      fileName: string;
      filas: number;
      duracionMs: number;
      expiresAt: number;
    }
  | { status: "error"; error: string };

const ERROR_MESSAGES: Record<string, string> = {
  unauthorized: "Tu sesión expiró. Vuelve a iniciar sesión.",
  forbidden: "No tienes permisos para esta exportación.",
  invalid_range: "El rango de fechas no es válido.",
  invalid_fields: "Selecciona al menos un campo habilitado.",
  invalid_filters: "Revisa los filtros: alguno no es válido.",
  netsuite_config: "Falta configurar las credenciales de NetSuite en el servidor.",
  netsuite_auth: "NetSuite rechazó la autenticación.",
  netsuite_query: "NetSuite devolvió un error al consultar los movimientos.",
  netsuite_limit: "Un día del rango supera el límite de filas de NetSuite.",
  timeout: "La consulta a NetSuite tardó demasiado. Prueba con un rango más corto.",
  storage: "No se pudo guardar el Excel en Storage.",
  internal: "Error inesperado al generar el Excel.",
};

const URL_TTL_MS = 60 * 60 * 1000;

const FILAS_FORMATTER = new Intl.NumberFormat("es-CO");
const HORA_FORMATTER = new Intl.DateTimeFormat("es-CO", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `m:ss`, el formato de un cronómetro. */
function formatCronometro(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

function formatDuracion(ms: number): string {
  const total = Math.round(ms / 1000);
  const min = Math.floor(total / 60);
  const s = total % 60;
  return min > 0 ? `${min} min ${s.toString().padStart(2, "0")} s` : `${s} s`;
}

/** Mensaje claro según la respuesta, incluido el 504 de Vercel (sin JSON). */
async function mensajeDeError(res: Response): Promise<string> {
  const payload = (await res.json().catch(() => null)) as {
    error?: string;
    code?: string;
  } | null;
  if (payload?.error) return payload.error;
  if (payload?.code && ERROR_MESSAGES[payload.code]) return ERROR_MESSAGES[payload.code]!;
  if (res.status === 504) {
    return "El servidor superó el tiempo máximo (5 min). Prueba con un rango más corto.";
  }
  return `${ERROR_MESSAGES.internal} (HTTP ${res.status})`;
}

interface ExportBancosPageClientProps {
  /** Rango inicial (mes anterior), calculado en el servidor para hidratar igual. */
  rangoInicial: { inicio: string; fin: string };
  /** Hoy `YYYY-MM-DD`, del servidor: arma los accesos rápidos por mes. */
  hoy: string;
  campos: CampoCatalogo[];
  plantillas: Plantilla[];
  /** Nivel en el proceso: `ver` exporta, `usar` edita plantillas, `gestionar` el catálogo. */
  nivel: Nivel;
  /** Error al leer el catálogo (p. ej. migración sin aplicar). */
  errorCampos: string | null;
}

const PLANTILLA_POR_DEFECTO = "bancos estándar";

export function ExportBancosPageClient({
  rangoInicial,
  hoy,
  campos,
  plantillas,
  nivel,
  errorCampos,
}: ExportBancosPageClientProps) {
  const [fechaInicio, setFechaInicio] = useState(rangoInicial.inicio);
  const [fechaFin, setFechaFin] = useState(rangoInicial.fin);
  const habilitados = useMemo(() => campos.filter((c) => c.habilitado), [campos]);
  // Arranca con "Bancos estándar" (o la primera plantilla, o todo el catálogo).
  const [plantillaId, setPlantillaId] = useState<string | null>(() => {
    const p =
      plantillas.find((x) => x.nombre.trim().toLowerCase() === PLANTILLA_POR_DEFECTO) ??
      plantillas[0];
    return p?.id ?? null;
  });
  const [seleccion, setSeleccion] = useState<Set<string>>(() => {
    const p = plantillas.find((x) => x.id === plantillaId);
    const validos = new Set(habilitados.map((c) => c.id));
    return p ? new Set(p.campos.filter((id) => validos.has(id))) : validos;
  });
  const [filtros, setFiltros] = useState<Filtro[]>(() => {
    const p = plantillas.find((x) => x.id === plantillaId);
    return p ? filtrosValidos(p.filtros, new Set(habilitados.map((c) => c.id))) : [];
  });
  const [state, setState] = useState<ExportState>({ status: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const meses = useMemo(() => mesesRecientes(hoy), [hoy]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Cronómetro mientras se genera; reloj lento para el vencimiento del enlace.
  useEffect(() => {
    if (state.status !== "processing" && state.status !== "done") return;
    const id = setInterval(() => setNow(Date.now()), state.status === "processing" ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [state.status]);

  // Salir de la página cancela la consulta: pedir confirmación.
  useEffect(() => {
    if (state.status !== "processing") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state.status]);

  const rangoError = validarRango(fechaInicio, fechaFin);
  const dias = rangoError ? 0 : diasDelRango(fechaInicio, fechaFin).length;
  const busy = state.status === "processing";
  const plantilla = plantillas.find((p) => p.id === plantillaId) ?? null;
  // Solo ids que sigan habilitados (un admin pudo deshabilitar alguno).
  const camposElegidos = ordenColumnas(seleccion, habilitados, plantilla?.campos);
  const filtrosActivos = useMemo(() => filtros.filter(filtroActivo), [filtros]);
  const sinCampos = camposElegidos.length === 0;

  const nombreSeleccion = useMemo(() => {
    if (!plantilla) return "Selección propia";
    const validos = new Set(habilitados.map((c) => c.id));
    const ids = new Set(plantilla.campos.filter((id) => validos.has(id)));
    const iguales =
      mismosIds(seleccion, ids) && mismosFiltros(filtros, filtrosValidos(plantilla.filtros, validos));
    return iguales ? plantilla.nombre : `${plantilla.nombre} (modificada)`;
  }, [plantilla, habilitados, seleccion, filtros]);

  const elegirRango = (inicio: string, fin: string) => {
    setFechaInicio(inicio);
    setFechaFin(fin);
  };

  const generar = useCallback(async () => {
    if (validarRango(fechaInicio, fechaFin) || camposElegidos.length === 0) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const startedAt = Date.now();
    setNow(startedAt);
    setState({
      status: "processing",
      startedAt,
      dias: diasDelRango(fechaInicio, fechaFin).length,
    });

    try {
      const res = await fetch("/api/export-bancos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fechaInicio,
          fechaFin,
          campos: camposElegidos,
          filtros: filtrosActivos,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const error = await mensajeDeError(res);
        setState({ status: "error", error });
        toast.error(error);
        return;
      }
      const result = (await res.json()) as {
        url: string;
        fileName: string;
        filas: number;
        duracionMs: number;
      };
      setState({
        status: "done",
        ...result,
        expiresAt: Date.now() + URL_TTL_MS,
      });
      toast.success("Excel listo para descargar");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const error = "No se pudo contactar el servidor. Revisa tu conexión e intenta de nuevo.";
      setState({ status: "error", error });
      toast.error(error);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [fechaInicio, fechaFin, camposElegidos, filtrosActivos]);

  const cancelar = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState({ status: "idle" });
    toast("Exportación cancelada");
  };

  const motivoBloqueo = rangoError ?? (sinCampos ? "Selecciona al menos un campo." : null);
  const listo = state.status === "done" && now < state.expiresAt;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Auditoría Asientos de Diario
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Exporta a un solo Excel las líneas contables de un periodo de hasta {MAX_DIAS_EXPORT}{" "}
            días: de cuentas bancarias (sin asientos de diario) o, con un filtro de Tipo Cuenta, todos
            los documentos contables de esas cuentas.
          </p>
        </div>
        <ComoUsar steps={TOUR_EXPORT_BANCOS} />
      </header>

      <section
        aria-labelledby="exportar-title"
        className="grid min-w-0 grid-cols-1 rounded-lg border border-border bg-card shadow-sm lg:grid-cols-2"
      >
        <div className="flex flex-col gap-4 p-5">
          <h2
            id="exportar-title"
            className="text-base font-semibold tracking-tight text-foreground"
          >
            Periodo
          </h2>

          <div
            role="group"
            aria-label="Meses recientes"
            data-tour="meses"
            className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6"
          >
            {meses.map((m) => {
              const activo = m.inicio === fechaInicio && m.fin === fechaFin;
              return (
                <button
                  key={m.clave}
                  type="button"
                  aria-pressed={activo}
                  disabled={busy}
                  title={m.enCurso ? "Mes en curso, hasta hoy" : undefined}
                  onClick={() => elegirRango(m.inicio, m.fin)}
                  className={cn(
                    "relative flex h-8 items-center justify-center rounded-md border text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                    "disabled:pointer-events-none disabled:opacity-50",
                    activo
                      ? "border-primary/40 bg-primary/10 font-medium text-primary"
                      : "border-input bg-background text-foreground hover:bg-accent",
                  )}
                >
                  {m.etiqueta}
                  {m.enCurso && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute right-1 top-1 size-1.5 rounded-full",
                        activo ? "bg-primary" : "bg-muted-foreground/60",
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-auto grid grid-cols-2 gap-3" data-tour="fechas">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="fecha-inicio">Desde</Label>
              <Input
                id="fecha-inicio"
                type="date"
                className="font-mono tabular-nums"
                value={fechaInicio}
                max={fechaFin || undefined}
                disabled={busy}
                aria-invalid={rangoError !== null || undefined}
                aria-describedby={rangoError ? "rango-error" : undefined}
                onChange={(e) => setFechaInicio(e.target.value)}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="fecha-fin">Hasta</Label>
              <Input
                id="fecha-fin"
                type="date"
                className="font-mono tabular-nums"
                value={fechaFin}
                min={fechaInicio || undefined}
                disabled={busy}
                aria-invalid={rangoError !== null || undefined}
                aria-describedby={rangoError ? "rango-error" : undefined}
                onChange={(e) => setFechaFin(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4 border-t border-border p-5 lg:border-l lg:border-t-0">
          <h2 className="text-base font-semibold tracking-tight text-foreground">Exportación</h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm" data-tour="resumen">
            <dt className="text-muted-foreground">Rango</dt>
            <dd className="min-w-0 text-right text-foreground">
              {rangoError ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <>
                  {etiquetaRango(fechaInicio, fechaFin)}
                  <span className="ml-2 font-mono tabular-nums text-muted-foreground">
                    {dias} {dias === 1 ? "día" : "días"}
                  </span>
                </>
              )}
            </dd>
            <dt className="text-muted-foreground">Filtros</dt>
            <dd className="min-w-0 truncate text-right text-foreground">
              {filtrosActivos.length === 0 ? (
                <span className="text-muted-foreground">Ninguno, todas las líneas</span>
              ) : (
                <>
                  <span className="font-mono tabular-nums">{filtrosActivos.length}</span>
                  <span className="ml-2 text-muted-foreground">
                    {filtrosActivos.length === 1 ? "filtro activo" : "filtros activos"}
                  </span>
                </>
              )}
            </dd>
            <dt className="text-muted-foreground">Columnas</dt>
            <dd className="min-w-0 truncate text-right text-foreground" title={nombreSeleccion}>
              <span className="font-mono tabular-nums">{camposElegidos.length}</span>
              <span className="ml-2 text-muted-foreground">{nombreSeleccion}</span>
            </dd>
          </dl>

          {motivoBloqueo && (
            <p
              id={rangoError ? "rango-error" : undefined}
              className="text-sm text-destructive"
              role="alert"
            >
              {motivoBloqueo}
            </p>
          )}

          {busy ? (
            <Button variant="outline" className="mt-auto w-full" onClick={cancelar} data-tour="generar">
              <X aria-hidden />
              Cancelar
            </Button>
          ) : (
            <Button
              data-tour="generar"
              className="mt-auto w-full"
              // Con un Excel listo, la acción principal pasa a ser Descargar.
              variant={listo ? "outline" : "default"}
              onClick={() => void generar()}
              disabled={motivoBloqueo !== null}
            >
              <FileSpreadsheet aria-hidden />
              {listo ? "Generar de nuevo" : "Generar Excel"}
            </Button>
          )}
        </div>

        <EstadoExportacion
          state={state}
          now={now}
          puedeReintentar={motivoBloqueo === null}
          onReintentar={() => void generar()}
        />
      </section>

      {errorCampos ? (
        <p className="rounded-lg border border-destructive/30 bg-card p-5 text-sm text-destructive shadow-sm">
          No se pudo cargar el catálogo de campos: {errorCampos}
        </p>
      ) : (
        <>
          <FiltrosCard
            campos={habilitados}
            filtros={filtros}
            onFiltrosChange={setFiltros}
            disabled={busy}
          />
          <CamposCard
            campos={campos}
            plantillas={plantillas}
            puedeGestionar={nivel === "gestionar"}
            puedeEditarPlantillas={nivel !== "ver"}
            seleccion={seleccion}
            onSeleccionChange={setSeleccion}
            filtros={filtros}
            onFiltrosChange={setFiltros}
            plantillaId={plantillaId}
            onPlantillaChange={setPlantillaId}
            disabled={busy}
          />
        </>
      )}
    </div>
  );
}

function EstadoExportacion({
  state,
  now,
  puedeReintentar,
  onReintentar,
}: {
  state: ExportState;
  now: number;
  puedeReintentar: boolean;
  onReintentar: () => void;
}) {
  return (
    <div
      aria-live="polite"
      data-tour="estado"
      className="flex min-h-16 flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between lg:col-span-2"
    >
      {state.status === "idle" && (
        <p className="text-sm text-muted-foreground">
          Un mes de bancos suele tardar alrededor de un minuto; uno de ingresos, unos 3. El enlace
          de descarga dura 1 hora.
        </p>
      )}

      {state.status === "processing" && (
        <div className="flex w-full min-w-0 items-center gap-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden />
          <p className="min-w-0 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Consultando NetSuite</span> ·{" "}
            <span className="font-mono tabular-nums">{state.dias}</span>{" "}
            {state.dias === 1 ? "día" : "días"} en paralelo. No cierres esta pestaña.
          </p>
          <span
            className="ml-auto shrink-0 font-mono text-sm tabular-nums text-muted-foreground"
            aria-hidden
          >
            {formatCronometro(now - state.startedAt)}
          </span>
        </div>
      )}

      {state.status === "done" &&
        (now < state.expiresAt ? (
          <>
            <div className="flex min-w-0 items-center gap-3">
              <FileSpreadsheet
                className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p
                  className="truncate font-mono text-sm font-medium text-foreground"
                  title={state.fileName}
                >
                  {state.fileName}
                </p>
                <p className="text-sm text-muted-foreground">
                  <span className="font-mono tabular-nums text-foreground">
                    {FILAS_FORMATTER.format(state.filas)}
                  </span>{" "}
                  {state.filas === 1 ? "fila" : "filas"} en{" "}
                  <span className="font-mono tabular-nums">{formatDuracion(state.duracionMs)}</span>{" "}
                  · enlace válido hasta las{" "}
                  <span className="font-mono tabular-nums">
                    {HORA_FORMATTER.format(state.expiresAt)}
                  </span>
                </p>
              </div>
            </div>
            <Button className="w-full shrink-0 sm:w-auto" asChild>
              <a href={state.url} download={state.fileName}>
                <Download aria-hidden />
                Descargar
              </a>
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            El enlace de <span className="font-mono">{state.fileName}</span> venció. Genera el Excel
            de nuevo para descargarlo.
          </p>
        ))}

      {state.status === "error" && (
        <>
          <div className="flex min-w-0 items-center gap-3">
            <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden />
            <p className="min-w-0 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">No se pudo generar el Excel.</span>{" "}
              {state.error}
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full shrink-0 sm:w-auto"
            onClick={onReintentar}
            disabled={!puedeReintentar}
          >
            <RefreshCw aria-hidden />
            Reintentar
          </Button>
        </>
      )}
    </div>
  );
}

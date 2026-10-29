"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  FileClock,
  Loader2,
  Paperclip,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Settings2,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { SoloLectura } from "@/components/common/solo-lectura";
import { ComoUsar } from "@/components/tour/como-usar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { periodoCorto, periodoLabel } from "@/lib/comisiones/calculo";
import { prepararMes } from "@/lib/servicios-publicos/actions";
import { NIVEL_ALERTA_LABEL, PESO_ALERTA, alertaDe, type Alerta, type NivelAlerta } from "@/lib/servicios-publicos/alertas";
import {
  ESTADOS,
  ESTADO_LABEL,
  formatFecha,
  formatValor,
  type Recibo,
  type Servicio,
} from "@/lib/servicios-publicos/schema";
import { cn } from "@/lib/utils";

import { AlertaIndicador, ETIQUETA, EstadoBadge, FiltroSelect, SectionLabel, TODOS } from "./bits";
import { PasoDialog, type Paso } from "./paso-dialog";
import { ReciboDetalle } from "./recibo-detalle";
import { ReciboFormDialog, type ModoFormulario } from "./recibo-form-dialog";
import { ServiciosDialog } from "./servicios-dialog";
import { SiguientePaso, type AccionRecibo } from "./siguiente-paso";
import { TOUR_SERVICIOS_PUBLICOS } from "./tour";

interface Filtros {
  mes: string;
  proveedor: string;
  estado: string;
  semaforo: string;
  pago: string;
  q: string;
}

const PAGO_OPCIONES = [
  { value: "pagado", label: "Pagados" },
  { value: "sin_pagar", label: "Sin pagar" },
];

const SEMAFORO_OPCIONES = (["revisar", "atencion", "ok"] as NivelAlerta[]).map((n) => ({
  value: n,
  label: NIVEL_ALERTA_LABEL[n],
}));

const ESTADO_OPCIONES = ESTADOS.map((e) => ({ value: e, label: ESTADO_LABEL[e] }));

/** `soloLectura` (nivel `ver`): consulta y descarga soportes, sin crear ni modificar. */
export function ServiciosPublicosPageClient({
  servicios,
  recibos,
  hoy,
  errorDatos,
  soloLectura,
}: {
  servicios: Servicio[];
  recibos: Recibo[];
  /** `YYYY-MM-DD` en hora de Colombia. */
  hoy: string;
  errorDatos: string | null;
  soloLectura: boolean;
}) {
  const mesActual = hoy.slice(0, 7);
  const filtrosIniciales: Filtros = {
    mes: mesActual,
    proveedor: TODOS,
    estado: TODOS,
    semaforo: TODOS,
    pago: TODOS,
    q: "",
  };
  const [filtros, setFiltros] = useState<Filtros>(filtrosIniciales);
  const [formulario, setFormulario] = useState<ModoFormulario | null>(null);
  const [paso, setPaso] = useState<Paso | null>(null);
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [serviciosAbierto, setServiciosAbierto] = useState<"lista" | "nuevo" | null>(null);
  const [preparando, startPreparar] = useTransition();

  const set = (cambio: Partial<Filtros>) => setFiltros((f) => ({ ...f, ...cambio }));

  const alertas = useMemo(() => new Map<string, Alerta>(recibos.map((r) => [r.id, alertaDe(r, hoy)])), [recibos, hoy]);

  // ─── Indicadores (todos los meses) ───
  const indicadores = useMemo(() => {
    let revisar = 0;
    let porLlegar = 0;
    let pendientesPago = 0;
    let valorPendiente = 0;
    for (const r of recibos) {
      if (alertas.get(r.id)?.nivel === "revisar") revisar++;
      if (r.estado === "pendiente_factura") porLlegar++;
      if (r.estado === "registrado") {
        pendientesPago++;
        valorPendiente += r.valor ?? 0;
      }
    }
    return { revisar, porLlegar, pendientesPago, valorPendiente };
  }, [recibos, alertas]);

  // ─── Conteo mensual (se calcula de los recibos; no hay contador guardado) ───
  const meses = useMemo(() => {
    const porMes = new Map<string, { total: number; registrados: number }>();
    porMes.set(mesActual, { total: 0, registrados: 0 });
    for (const r of recibos) {
      const m = porMes.get(r.mes) ?? { total: 0, registrados: 0 };
      m.total++;
      if (r.estado === "registrado" || r.estado === "pagado") m.registrados++;
      porMes.set(r.mes, m);
    }
    return [...porMes.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([mes, c]) => ({ mes, ...c }));
  }, [recibos, mesActual]);

  const mesIndicador = filtros.mes === TODOS ? mesActual : filtros.mes;
  const conteoMes = meses.find((m) => m.mes === mesIndicador) ?? { mes: mesIndicador, total: 0, registrados: 0 };

  // Servicios activos sin recibo en el mes elegido: se pueden crear como "pendiente de factura".
  const faltantes = useMemo(() => {
    if (filtros.mes === TODOS) return [];
    const conRecibo = new Set(recibos.filter((r) => r.mes === filtros.mes).map((r) => r.servicio_id));
    return servicios.filter((s) => s.activo && !conRecibo.has(s.id));
  }, [filtros.mes, recibos, servicios]);

  const proveedores = useMemo(
    () => [...new Set(servicios.map((s) => s.proveedor))].sort().map((p) => ({ value: p, label: p })),
    [servicios],
  );

  const filas = useMemo(() => {
    const q = filtros.q.trim().toLowerCase();
    return recibos
      .filter((r) => {
        if (filtros.mes !== TODOS && r.mes !== filtros.mes) return false;
        if (filtros.proveedor !== TODOS && r.proveedor !== filtros.proveedor) return false;
        if (filtros.estado !== TODOS && r.estado !== filtros.estado) return false;
        if (filtros.semaforo !== TODOS && alertas.get(r.id)?.nivel !== filtros.semaforo) return false;
        if (filtros.pago === "pagado" && r.estado !== "pagado") return false;
        if (filtros.pago === "sin_pagar" && r.estado === "pagado") return false;
        if (q && !`${r.proveedor} ${r.servicio} ${r.referencia ?? ""}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          b.mes.localeCompare(a.mes) ||
          PESO_ALERTA[alertas.get(a.id)!.nivel] - PESO_ALERTA[alertas.get(b.id)!.nivel] ||
          a.proveedor.localeCompare(b.proveedor) ||
          a.servicio.localeCompare(b.servicio),
      );
  }, [recibos, filtros, alertas]);

  const hayFiltros =
    filtros.proveedor !== TODOS ||
    filtros.estado !== TODOS ||
    filtros.semaforo !== TODOS ||
    filtros.pago !== TODOS ||
    filtros.q !== "";

  const onAccion = useCallback((a: AccionRecibo) => {
    if (a.tipo === "soporte") {
      setDetalleId(a.recibo.id);
      return;
    }
    setDetalleId(null);
    if (a.tipo === "editar" || a.tipo === "factura") setFormulario({ tipo: a.tipo, recibo: a.recibo });
    else setPaso({ tipo: a.tipo, recibo: a.recibo });
  }, []);
  const cerrarFormulario = useCallback(() => setFormulario(null), []);
  const cerrarPaso = useCallback(() => setPaso(null), []);
  const cerrarDetalle = useCallback(() => setDetalleId(null), []);

  function crearPendientes() {
    const mes = filtros.mes;
    startPreparar(async () => {
      const res = await prepararMes(mes);
      if (res.error) toast.error(res.error);
      else toast.success(`${res.creados} ${res.creados === 1 ? "recibo creado" : "recibos creados"} para ${periodoLabel(mes)}`);
    });
  }

  const detalle = detalleId ? (recibos.find((r) => r.id === detalleId) ?? null) : null;
  const columnas = 7 + (filtros.mes === TODOS ? 1 : 0) + (soloLectura ? 0 : 1);

  // Sin datos no se muestran indicadores ni tabla en cero: dirían "no hay nada pendiente" cuando
  // en realidad no se sabe.
  if (errorDatos) return <ErrorCarga detalle={errorDatos} />;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-tour="indicadores">
        <Indicador
          icon={<AlertTriangle className="size-4" />}
          label="Requieren revisión"
          value={indicadores.revisar}
          tone={indicadores.revisar > 0 ? "destructive" : "muted"}
          detalle="Un plazo ya pasó"
          activo={filtros.semaforo === "revisar" && filtros.mes === TODOS}
          onClick={() => setFiltros({ ...filtrosIniciales, mes: TODOS, semaforo: "revisar" })}
        />
        <Indicador
          icon={<FileClock className="size-4" />}
          label="Facturas por llegar"
          value={indicadores.porLlegar}
          tone="muted"
          detalle="Todos los meses"
          activo={filtros.estado === "pendiente_factura" && filtros.mes === TODOS}
          onClick={() => setFiltros({ ...filtrosIniciales, mes: TODOS, estado: "pendiente_factura" })}
        />
        <Indicador
          icon={<Wallet className="size-4" />}
          label="Pendientes de pago"
          value={indicadores.pendientesPago}
          tone="warning"
          detalle={indicadores.valorPendiente > 0 ? formatValor(indicadores.valorPendiente) : "En Tesorería"}
          activo={filtros.estado === "registrado" && filtros.mes === TODOS}
          onClick={() => setFiltros({ ...filtrosIniciales, mes: TODOS, estado: "registrado" })}
        />
        <Indicador
          icon={<ReceiptText className="size-4" />}
          label={`Registrados · ${periodoCorto(mesIndicador)}`}
          value={conteoMes.registrados}
          tone="default"
          detalle={`de ${conteoMes.total} ${conteoMes.total === 1 ? "recibo" : "recibos"} del mes`}
          activo={false}
          onClick={() => setFiltros({ ...filtrosIniciales, mes: mesIndicador })}
        />
      </div>

      <section className="flex flex-col gap-2.5" data-tour="meses" aria-labelledby="sp-meses-titulo">
        <h2 id="sp-meses-titulo">
          <SectionLabel>Recibos registrados por mes</SectionLabel>
        </h2>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <MesChip
            seleccionado={filtros.mes === TODOS}
            onClick={() => set({ mes: TODOS })}
            titulo="Todos"
            valor={meses.reduce((acc, m) => acc + m.registrados, 0)}
            pie={`de ${recibos.length}`}
          />
          {meses.map((m) => (
            <MesChip
              key={m.mes}
              seleccionado={filtros.mes === m.mes}
              onClick={() => set({ mes: m.mes })}
              titulo={periodoCorto(m.mes)}
              valor={m.registrados}
              pie={`de ${m.total}`}
              actual={m.mes === mesActual}
            />
          ))}
        </div>
      </section>

      <div className="flex flex-col-reverse items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
        <p className="text-sm text-muted-foreground">
          Sigue cada recibo desde la factura hasta el pago y su soporte. El semáforo indica qué revisar primero.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ComoUsar steps={TOUR_SERVICIOS_PUBLICOS} className="h-9" />
          <Button type="button" variant="outline" onClick={() => setServiciosAbierto("lista")} data-tour="servicios">
            <Settings2 className="size-4" />
            Servicios
          </Button>
          {!soloLectura && (
            <Button type="button" onClick={() => setFormulario({ tipo: "nuevo" })}>
              <Plus className="size-4" />
              Nuevo recibo
            </Button>
          )}
        </div>
      </div>

      {soloLectura && <SoloLectura />}

      {servicios.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Zap />
            </EmptyMedia>
            <EmptyTitle>Empieza por tus servicios</EmptyTitle>
            <EmptyDescription>
              Agrega cada servicio público que llega cada mes (proveedor, referencia y día de corte). Después el portal
              crea los recibos esperados y te avisa cuando una factura no llega a tiempo.
            </EmptyDescription>
          </EmptyHeader>
          {!soloLectura && (
            <EmptyContent>
              <Button type="button" variant="outline" onClick={() => setServiciosAbierto("nuevo")}>
                <Plus className="size-4" />
                Agregar el primer servicio
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          {faltantes.length > 0 && !soloLectura && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-[75ch] text-sm">
                <span className="font-semibold">
                  {faltantes.length} {faltantes.length === 1 ? "servicio activo no tiene" : "servicios activos no tienen"} recibo en{" "}
                  {periodoLabel(filtros.mes)}.
                </span>{" "}
                <span className="text-muted-foreground">
                  {faltantes.slice(0, 3).map((s) => `${s.proveedor} · ${s.servicio}`).join(", ")}
                  {faltantes.length > 3 ? ` y ${faltantes.length - 3} más` : ""}. Créalos como pendientes de factura para hacerles seguimiento.
                </span>
              </p>
              <Button type="button" size="sm" variant="outline" onClick={crearPendientes} disabled={preparando} className="shrink-0">
                {preparando ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                Crear pendientes
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filtros.q}
                onChange={(e) => set({ q: e.target.value })}
                placeholder="Buscar proveedor o referencia"
                aria-label="Buscar proveedor o referencia"
                className="h-9 pl-9"
              />
            </div>
            <FiltroSelect label="Proveedor" value={filtros.proveedor} onChange={(v) => set({ proveedor: v })} options={proveedores} />
            <FiltroSelect label="Estado" value={filtros.estado} onChange={(v) => set({ estado: v })} options={ESTADO_OPCIONES} />
            <FiltroSelect label="Semáforo" value={filtros.semaforo} onChange={(v) => set({ semaforo: v })} options={SEMAFORO_OPCIONES} />
            <FiltroSelect label="Pago" value={filtros.pago} onChange={(v) => set({ pago: v })} options={PAGO_OPCIONES} />
            {hayFiltros && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setFiltros({ ...filtrosIniciales, mes: filtros.mes })}>
                <X className="size-3.5" />
                Limpiar filtros
              </Button>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm" data-tour="tabla">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48">Seguimiento</TableHead>
                    <TableHead>Servicio</TableHead>
                    {filtros.mes === TODOS && <TableHead>Mes</TableHead>}
                    <TableHead>Corte</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Pago y soporte</TableHead>
                    {!soloLectura && <TableHead className="text-right">Siguiente paso</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={columnas} className="py-10 text-center text-sm text-muted-foreground">
                        {recibos.length === 0
                          ? "Aún no hay recibos. Crea los pendientes del mes o registra uno nuevo."
                          : "No hay recibos con estos filtros."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filas.map((r) => (
                      <FilaRecibo
                        key={r.id}
                        recibo={r}
                        alerta={alertas.get(r.id)!}
                        soloLectura={soloLectura}
                        conMes={filtros.mes === TODOS}
                        onAbrir={() => setDetalleId(r.id)}
                        onAccion={onAccion}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              {filas.length} {filas.length === 1 ? "recibo" : "recibos"}
              {filtros.mes !== TODOS ? ` · ${periodoLabel(filtros.mes)}` : " · todos los meses"}
            </div>
          </div>
        </>
      )}

      <ReciboFormDialog
        modo={formulario}
        onClose={cerrarFormulario}
        servicios={servicios}
        mesInicial={filtros.mes === TODOS ? mesActual : filtros.mes}
        hoy={hoy}
      />
      <PasoDialog paso={paso} onClose={cerrarPaso} hoy={hoy} />
      <ReciboDetalle recibo={detalle} hoy={hoy} soloLectura={soloLectura} onClose={cerrarDetalle} onAccion={onAccion} />
      <ServiciosDialog
        open={serviciosAbierto !== null}
        onOpenChange={(open) => !open && setServiciosAbierto(null)}
        servicios={servicios}
        soloLectura={soloLectura}
        nuevoAlAbrir={serviciosAbierto === "nuevo"}
      />
    </div>
  );
}

function FilaRecibo({
  recibo: r,
  alerta,
  soloLectura,
  conMes,
  onAbrir,
  onAccion,
}: {
  recibo: Recibo;
  alerta: Alerta;
  soloLectura: boolean;
  /** Solo con "Todos los meses": con un mes elegido la columna repetiría el mismo valor. */
  conMes: boolean;
  onAbrir: () => void;
  onAccion: (a: AccionRecibo) => void;
}) {
  return (
    <TableRow
      tabIndex={0}
      aria-label={`${r.proveedor} ${r.servicio}, ${periodoLabel(r.mes)}: ${alerta.motivo}`}
      className="cursor-pointer outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onAbrir();
      }}
    >
      <TableCell className="max-w-48">
        <AlertaIndicador alerta={alerta} />
      </TableCell>
      <TableCell>
        <p className="font-semibold text-foreground">{r.proveedor}</p>
        <p className="text-xs text-muted-foreground">
          {r.servicio}
          {r.referencia && <span className="font-mono"> · {r.referencia}</span>}
        </p>
      </TableCell>
      {conMes && (
        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{periodoCorto(r.mes)}</TableCell>
      )}
      <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{formatFecha(r.fecha_corte)}</TableCell>
      <TableCell className="whitespace-nowrap text-right font-mono text-sm tabular-nums">{formatValor(r.valor)}</TableCell>
      <TableCell>
        <EstadoBadge estado={r.estado} />
        {r.fecha_registro && (
          <p className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
            Reg. <span className="font-mono">{formatFecha(r.fecha_registro)}</span>
          </p>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        {r.fecha_pago ? (
          <>
            <p className="font-medium text-emerald-700 dark:text-emerald-300">
              Pagado <span className="font-mono">{formatFecha(r.fecha_pago)}</span>
            </p>
            {r.soporte_nombre ? (
              <p className="mt-1 inline-flex items-center gap-1 text-muted-foreground" title={r.soporte_nombre}>
                <Paperclip className="size-3" />
                Con soporte
              </p>
            ) : (
              <p className="mt-1 font-medium text-amber-700 dark:text-amber-300">Falta soporte</p>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">Pendiente</span>
        )}
      </TableCell>
      {!soloLectura && (
        <TableCell className="text-right">
          <SiguientePaso recibo={r} onAccion={onAccion} variant="outline" />
        </TableCell>
      )}
    </TableRow>
  );
}

function ErrorCarga({ detalle }: { detalle: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Empty role="alert" className="border-destructive/30">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="border-destructive/20 bg-destructive/10 text-destructive">
          <AlertTriangle />
        </EmptyMedia>
        <EmptyTitle>No se pudieron cargar los recibos</EmptyTitle>
        <EmptyDescription>
          Intenta de nuevo en unos segundos. Si el problema sigue, avisa al equipo del portal con este detalle:
        </EmptyDescription>
        <code className="max-w-full break-words rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">{detalle}</code>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" variant="outline" onClick={() => startTransition(() => router.refresh())} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Reintentar
        </Button>
      </EmptyContent>
    </Empty>
  );
}

type Tono = "default" | "warning" | "destructive" | "muted";

const TONO_INDICADOR: Record<Tono, string> = {
  default: "bg-primary/10 text-primary border-primary/15 dark:bg-primary/15 dark:text-primary-foreground/90 dark:border-primary/30",
  warning: "bg-amber-100 text-amber-700 border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40",
  destructive: "bg-rose-100 text-rose-700 border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40",
  muted: "bg-muted text-muted-foreground border-border",
};

/** Mismo diseño que el KPI tile de anticipos, pero como botón: filtra la tabla. */
function Indicador({
  icon,
  label,
  value,
  tone,
  detalle,
  activo,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: Tono;
  detalle: string;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        activo ? "border-primary ring-1 ring-primary/30" : "border-border",
      )}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md border", TONO_INDICADOR[tone])} aria-hidden>
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn(ETIQUETA, "truncate py-px")}>{label}</span>
        <span className="font-mono text-xl font-semibold tabular-nums text-foreground">{value}</span>
        <span className="truncate text-xs text-muted-foreground">{detalle}</span>
      </span>
    </button>
  );
}

function MesChip({
  titulo,
  valor,
  pie,
  seleccionado,
  actual = false,
  onClick,
}: {
  titulo: string;
  valor: number;
  pie: string;
  seleccionado: boolean;
  actual?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={seleccionado}
      className={cn(
        "flex min-w-[92px] shrink-0 flex-col items-start rounded-md border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        seleccionado ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border",
      )}
    >
      <span className={cn(ETIQUETA, "py-px")}>
        {titulo}
        {actual && <span className="sr-only"> (mes actual)</span>}
      </span>
      <span className="mt-1 font-mono text-base font-semibold leading-tight tabular-nums">{valor}</span>
      <span className="text-xs text-muted-foreground">{pie}</span>
    </button>
  );
}

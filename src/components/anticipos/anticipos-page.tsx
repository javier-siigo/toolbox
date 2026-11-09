"use client";

import { useCallback, useDeferredValue, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HandCoins,
  Loader2,
  Plus,
  Search,
  UserMinus,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { SoloLectura } from "@/components/common/solo-lectura";
import {
  FiltroSelect,
  Indicador,
  TODOS,
} from "@/components/servicios-publicos/bits";
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
import { descargarAnticiposExcel } from "@/lib/anticipos/export-excel";
import { formatAnticipoCurrency } from "@/lib/anticipos/format";
import {
  ANTICIPOS_FALTA_OPTIONS,
  ANTICIPOS_OBSERVACION_1_OPTIONS,
  type AnticipoRow,
} from "@/lib/anticipos/schema";
import {
  DIAS_ATRASO,
  NIVEL_SEGUIMIENTO_LABEL,
  PESO_SEGUIMIENTO,
  seguimientoDe,
  type Seguimiento,
} from "@/lib/anticipos/seguimiento";
import type { NivelAlerta } from "@/lib/servicios-publicos/alertas";

import { AnticipoSheet, type ModoSheet } from "./anticipo-sheet";
import { AnticiposTabla, ordenarFilas, type Orden } from "./anticipos-tabla";
import { ImportarRetiradosSheet } from "./importar-retirados/importar-retirados-sheet";
import { TOUR_ANTICIPOS } from "./tour";

interface Filtros {
  falta: string;
  observacion: string;
  seguimiento: string;
  colaborador: string;
  q: string;
}

const FILTROS_INICIALES: Filtros = {
  falta: TODOS,
  observacion: TODOS,
  seguimiento: TODOS,
  colaborador: TODOS,
  q: "",
};

/** `pendiente` agrupa atrasados y en plazo: todo lo que aún no se ha resuelto. */
const PENDIENTE = "pendiente";

const SEGUIMIENTO_OPCIONES = [
  { value: PENDIENTE, label: "Sin resolver" },
  ...(["revisar", "atencion", "ok"] as NivelAlerta[]).map((n) => ({
    value: n,
    label: NIVEL_SEGUIMIENTO_LABEL[n],
  })),
];

function cumpleSeguimiento(nivel: NivelAlerta | undefined, filtro: string): boolean {
  if (filtro === TODOS) return true;
  if (filtro === PENDIENTE) return nivel !== "ok";
  return nivel === filtro;
}

const COLABORADOR_OPCIONES = [
  { value: "activos", label: "Activos" },
  { value: "excolaboradores", label: "Excolaboradores" },
];

/** Filas que se pintan de entrada; "Mostrar más" agrega otro bloque. */
const BLOQUE = 50;

/** La sheet guarda solo el id: la fila se lee de `rows` para mostrar siempre lo último. */
type EstadoSheet = { tipo: "nuevo" } | { tipo: "detalle" | "editar"; id: string };

/** `soloLectura` (nivel `ver`): consulta la tabla sin crear, editar, legalizar ni importar. */
export function AnticiposPageClient({
  rows,
  hoy,
  soloLectura = false,
}: {
  rows: AnticipoRow[];
  /** `YYYY-MM-DD` en hora de Colombia. */
  hoy: string;
  soloLectura?: boolean;
}) {
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIALES);
  const [sheet, setSheet] = useState<EstadoSheet | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [limite, setLimite] = useState(BLOQUE);
  const [orden, setOrden] = useState<Orden>(null);
  const [exportando, startExport] = useTransition();

  const set = (cambio: Partial<Filtros>) => {
    setFiltros((f) => ({ ...f, ...cambio }));
    setLimite(BLOQUE);
  };
  const aplicar = (cambio: Partial<Filtros>) => {
    setFiltros({ ...FILTROS_INICIALES, ...cambio });
    setLimite(BLOQUE);
  };

  const seguimientos = useMemo(
    () => new Map<string, Seguimiento>(rows.map((r) => [r.id, seguimientoDe(r, hoy)])),
    [rows, hoy],
  );

  // ─── Indicadores (todos los registros, sin filtros) ───
  const indicadores = useMemo(() => {
    let atrasados = 0;
    let pendientes = 0;
    let valorPendiente = 0;
    let devoluciones = 0;
    let legalizados = 0;
    let excolaboradores = 0;
    let valorRetirados = 0;
    for (const r of rows) {
      const nivel = seguimientos.get(r.id)?.nivel;
      if (nivel === "revisar") atrasados++;
      if (nivel !== "ok") {
        pendientes++;
        valorPendiente += r.valor ?? 0;
      }
      if (r.falta === "devolucion") devoluciones++;
      if (r.falta === "legalizado") legalizados++;
      if (r.es_retirado) {
        excolaboradores++;
        if (r.falta !== "legalizado") valorRetirados += r.retiro_info?.valor ?? 0;
      }
    }
    const tasa = rows.length === 0 ? 0 : Math.round((legalizados / rows.length) * 100);
    return { atrasados, pendientes, valorPendiente, devoluciones, legalizados, tasa, excolaboradores, valorRetirados };
  }, [rows, seguimientos]);

  // El input usa `filtros.q` (responde al instante); filtrar y ordenar hasta 1000 filas usa el valor
  // diferido, que React calcula con prioridad baja sin bloquear el tecleo.
  const qDiferida = useDeferredValue(filtros.q);

  const filas = useMemo(() => {
    const q = qDiferida.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filtros.falta !== TODOS && r.falta !== filtros.falta) return false;
        if (filtros.observacion !== TODOS && r.observacion_1 !== filtros.observacion) return false;
        if (!cumpleSeguimiento(seguimientos.get(r.id)?.nivel, filtros.seguimiento)) return false;
        if (filtros.colaborador === "activos" && r.es_retirado) return false;
        if (filtros.colaborador === "excolaboradores" && !r.es_retirado) return false;
        if (q && !`${r.nombre} ${r.requerimiento} ${r.observacion_2 ?? ""}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const sa = seguimientos.get(a.id)!;
        const sb = seguimientos.get(b.id)!;
        const peso = PESO_SEGUIMIENTO[sa.nivel] - PESO_SEGUIMIENTO[sb.nivel];
        if (peso !== 0) return peso;
        // Pendientes: el más antiguo primero. Resueltos: el más reciente primero.
        return sa.nivel === "ok" ? b.fecha_rq.localeCompare(a.fecha_rq) : a.fecha_rq.localeCompare(b.fecha_rq);
      });
  }, [rows, filtros.falta, filtros.observacion, filtros.seguimiento, filtros.colaborador, qDiferida, seguimientos]);

  const ordenadas = useMemo(() => ordenarFilas(filas, orden, seguimientos), [filas, orden, seguimientos]);

  const valorFiltrado = useMemo(() => filas.reduce((acc, r) => acc + (r.valor ?? 0), 0), [filas]);

  const hayFiltros =
    filtros.falta !== TODOS ||
    filtros.observacion !== TODOS ||
    filtros.seguimiento !== TODOS ||
    filtros.colaborador !== TODOS ||
    filtros.q !== "";

  const modoSheet = useMemo<ModoSheet | null>(() => {
    if (!sheet) return null;
    if (sheet.tipo === "nuevo") return sheet;
    const row = rows.find((r) => r.id === sheet.id);
    return row ? { tipo: sheet.tipo, row } : null;
  }, [sheet, rows]);

  const cerrarSheet = useCallback(() => setSheet(null), []);
  // Estables para que las filas memoizadas de la tabla no se vuelvan a pintar al abrir la sheet.
  const abrirDetalle = useCallback((id: string) => setSheet({ tipo: "detalle", id }), []);
  const cambiarOrden = useCallback((o: Orden) => {
    setOrden(o);
    setLimite(BLOQUE);
  }, []);
  const cambiarModo = useCallback((m: ModoSheet) => {
    setSheet(m.tipo === "nuevo" ? m : { tipo: m.tipo, id: m.row.id });
  }, []);

  function exportar() {
    startExport(async () => {
      try {
        await descargarAnticiposExcel({
          rows: ordenadas,
          totalRegistros: rows.length,
          hoy,
          filtros: {
            busqueda: filtros.q,
            falta: filtros.falta === TODOS ? "" : filtros.falta,
            observacion1: filtros.observacion === TODOS ? "" : filtros.observacion,
            seguimiento: filtros.seguimiento === TODOS ? "" : filtros.seguimiento,
            colaborador: filtros.colaborador === TODOS ? "" : filtros.colaborador,
          },
        });
      } catch (err) {
        console.error("[anticipos] exportar excel", err);
        toast.error("No se pudo generar el Excel. Intenta de nuevo.");
      }
    });
  }

  const visibles = ordenadas.slice(0, limite);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-tour="indicadores">
        <Indicador
          icon={<AlertTriangle className="size-4" />}
          label="Atrasados"
          value={indicadores.atrasados}
          tone={indicadores.atrasados > 0 ? "destructive" : "muted"}
          detalle={`≥ ${DIAS_ATRASO} días sin gestión`}
          activo={filtros.seguimiento === "revisar"}
          onClick={() => aplicar({ seguimiento: "revisar" })}
        />
        <Indicador
          icon={<Wallet className="size-4" />}
          label="Sin resolver"
          value={indicadores.pendientes}
          tone="warning"
          detalle={indicadores.valorPendiente > 0 ? formatAnticipoCurrency(indicadores.valorPendiente)! : "Sin fecha de gestión"}
          activo={filtros.seguimiento === PENDIENTE}
          onClick={() => aplicar({ seguimiento: PENDIENTE })}
        />
        <Indicador
          icon={<HandCoins className="size-4" />}
          label="Devoluciones"
          value={indicadores.devoluciones}
          tone="muted"
          detalle="Falta: devolución"
          activo={filtros.falta === "devolucion"}
          onClick={() => aplicar({ falta: "devolucion" })}
        />
        <Indicador
          icon={<CheckCircle2 className="size-4" />}
          label="Legalizados"
          value={indicadores.legalizados}
          tone="success"
          detalle={rows.length > 0 ? `${indicadores.tasa}% de ${rows.length}` : "Sin registros"}
          activo={filtros.falta === "legalizado"}
          onClick={() => aplicar({ falta: "legalizado" })}
        />
        <Indicador
          icon={<UserMinus className="size-4" />}
          label="Excolaboradores"
          value={indicadores.excolaboradores}
          tone="muted"
          detalle={
            indicadores.valorRetirados > 0
              ? `Pendiente ${formatAnticipoCurrency(indicadores.valorRetirados)}`
              : undefined
          }
          activo={filtros.colaborador === "excolaboradores"}
          onClick={() => aplicar({ colaborador: "excolaboradores" })}
          accion={
            !soloLectura && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setImportOpen(true)}
                data-tour="importar"
                className="h-auto p-0 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {indicadores.excolaboradores > 0 ? "Actualizar reporte →" : "Importar reporte →"}
              </Button>
            )
          }
        />
      </div>

      <div className="flex flex-col-reverse items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
        <p className="text-sm text-muted-foreground">
          Sigue cada anticipo por colaborador y requerimiento hasta legalizarlo. El semáforo indica qué revisar primero.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ComoUsar steps={TOUR_ANTICIPOS} className="h-9" />
          {!soloLectura && (
            <>
              <Button type="button" onClick={() => setSheet({ tipo: "nuevo" })} data-tour="nuevo">
                <Plus className="size-4" />
                Nuevo registro
              </Button>
            </>
          )}
        </div>
      </div>

      {soloLectura && <SoloLectura />}

      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HandCoins />
            </EmptyMedia>
            <EmptyTitle>Aún no hay anticipos</EmptyTitle>
            <EmptyDescription>
              Registra cada anticipo con el colaborador, el requerimiento y el valor. Después importa el reporte de
              retirados de Contabilidad para marcar los de excolaboradores.
            </EmptyDescription>
          </EmptyHeader>
          {!soloLectura && (
            <EmptyContent>
              <Button type="button" variant="outline" onClick={() => setSheet({ tipo: "nuevo" })}>
                <Plus className="size-4" />
                Registrar el primer anticipo
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center" data-tour="filtros">
            <div className="relative w-full sm:w-64" data-tour="buscar">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filtros.q}
                onChange={(e) => set({ q: e.target.value })}
                placeholder="Buscar colaborador o requerimiento"
                aria-label="Buscar colaborador o requerimiento"
                className="h-9 pl-9"
              />
            </div>
            <FiltroSelect
              label="Seguimiento"
              value={filtros.seguimiento}
              onChange={(v) => set({ seguimiento: v })}
              options={SEGUIMIENTO_OPCIONES}
            />
            <FiltroSelect
              label="Falta"
              value={filtros.falta}
              onChange={(v) => set({ falta: v })}
              options={ANTICIPOS_FALTA_OPTIONS}
              todosLabel="Todas"
            />
            <FiltroSelect
              label="Observación"
              value={filtros.observacion}
              onChange={(v) => set({ observacion: v })}
              options={ANTICIPOS_OBSERVACION_1_OPTIONS}
              todosLabel="Todas"
            />
            <FiltroSelect
              label="Colaborador"
              value={filtros.colaborador}
              onChange={(v) => set({ colaborador: v })}
              options={COLABORADOR_OPCIONES}
            />
            {hayFiltros && (
              <Button type="button" variant="ghost" size="sm" onClick={() => aplicar({})}>
                <X className="size-3.5" />
                Limpiar filtros
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={exportar}
              disabled={exportando || filas.length === 0}
              data-tour="exportar"
              className="h-9 sm:ml-auto"
            >
              {exportando ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {exportando ? "Generando…" : "Descargar Excel"}
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm" data-tour="tabla">
            <AnticiposTabla
              filas={visibles}
              seguimientos={seguimientos}
              soloLectura={soloLectura}
              orden={orden}
              onOrden={cambiarOrden}
              onAbrir={abrirDetalle}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {filas.length === rows.length
                  ? `${filas.length} ${filas.length === 1 ? "registro" : "registros"}`
                  : `${filas.length} de ${rows.length} registros`}
                {valorFiltrado > 0 && (
                  <>
                    {" · "}
                    <span className="font-mono">{formatAnticipoCurrency(valorFiltrado)}</span>
                  </>
                )}
              </span>
              {filas.length > limite && (
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setLimite((l) => l + BLOQUE)}>
                  Mostrar {Math.min(BLOQUE, filas.length - limite)} más
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      <AnticipoSheet modo={modoSheet} hoy={hoy} soloLectura={soloLectura} onModo={cambiarModo} onClose={cerrarSheet} />
      <ImportarRetiradosSheet open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

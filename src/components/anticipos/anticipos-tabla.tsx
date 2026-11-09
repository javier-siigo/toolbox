"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { AlertaIndicador } from "@/components/servicios-publicos/bits";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAnticipoCurrency, formatAnticipoFecha } from "@/lib/anticipos/format";
import {
  ANTICIPOS_FALTA_LABELS,
  ANTICIPOS_OBSERVACION_1_LABELS,
  type AnticipoRow,
} from "@/lib/anticipos/schema";
import {
  NIVEL_SEGUIMIENTO_LABEL,
  PESO_SEGUIMIENTO,
  type Seguimiento,
} from "@/lib/anticipos/seguimiento";
import { cn } from "@/lib/utils";

import { ExcolaboradorChip, FaltaBadge, ObservacionBadge } from "./badges";
import { LegalizarBoton } from "./legalizar-boton";

// ─── Columnas ───

export type ColumnaId =
  | "seguimiento"
  | "colaborador"
  | "valor"
  | "falta"
  | "observacion"
  | "fecha_rq"
  | "fecha_gestion"
  | "accion";

interface Columna {
  id: ColumnaId;
  titulo: string;
  /** Ancho relativo por defecto: las columnas se reparten el ancho de la tabla en esta proporción. */
  peso: number;
  /** Ancho mínimo en px al redimensionar. */
  min: number;
  align?: "right";
  ordenable: boolean;
}

const COLUMNAS: Columna[] = [
  { id: "seguimiento", titulo: "Seguimiento", peso: 12, min: 96, ordenable: true },
  { id: "colaborador", titulo: "Colaborador", peso: 19, min: 140, ordenable: true },
  { id: "valor", titulo: "Valor", peso: 10, min: 88, align: "right", ordenable: true },
  { id: "falta", titulo: "Falta", peso: 15, min: 110, ordenable: true },
  { id: "observacion", titulo: "Observación", peso: 16, min: 120, ordenable: true },
  { id: "fecha_rq", titulo: "Fecha RQ", peso: 9, min: 92, ordenable: true },
  { id: "fecha_gestion", titulo: "Gestión", peso: 9, min: 92, ordenable: true },
  { id: "accion", titulo: "Siguiente paso", peso: 10, min: 56, align: "right", ordenable: false },
];

const PESOS_DEFAULT = Object.fromEntries(COLUMNAS.map((c) => [c.id, c.peso])) as Record<ColumnaId, number>;
const STORAGE_KEY = "toolbox:anticipos:anchos:v3";

function cargarPesos(): Record<ColumnaId, number> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return PESOS_DEFAULT;
    const parsed = JSON.parse(raw) as Partial<Record<ColumnaId, number>>;
    const out = { ...PESOS_DEFAULT };
    for (const c of COLUMNAS) {
      const v = parsed[c.id];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) out[c.id] = v;
    }
    return out;
  } catch {
    return PESOS_DEFAULT;
  }
}

function guardarPesos(pesos: Record<ColumnaId, number>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pesos));
  } catch {
    // almacenamiento bloqueado o lleno: los anchos solo duran la sesión
  }
}

// ─── Orden ───

export type Orden = { id: Exclude<ColumnaId, "accion">; dir: "asc" | "desc" } | null;

const colator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Vacíos siempre al final, sin importar la dirección. */
function compararNullable<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return cmp(a, b) * dir;
}

/** `orden = null` deja el orden recibido (el del semáforo). */
export function ordenarFilas(
  filas: AnticipoRow[],
  orden: Orden,
  seguimientos: Map<string, Seguimiento>,
): AnticipoRow[] {
  if (!orden) return filas;
  const dir = orden.dir === "asc" ? 1 : -1;
  const cmp = (a: AnticipoRow, b: AnticipoRow): number => {
    switch (orden.id) {
      case "seguimiento": {
        const sa = seguimientos.get(a.id)!;
        const sb = seguimientos.get(b.id)!;
        return (
          (PESO_SEGUIMIENTO[sa.nivel] - PESO_SEGUIMIENTO[sb.nivel]) * dir ||
          ((sb.dias ?? -1) - (sa.dias ?? -1)) * dir
        );
      }
      case "colaborador":
        return colator.compare(a.nombre, b.nombre) * dir;
      case "valor":
        return compararNullable(a.valor, b.valor, (x, y) => x - y, dir);
      case "falta":
        return colator.compare(ANTICIPOS_FALTA_LABELS[a.falta], ANTICIPOS_FALTA_LABELS[b.falta]) * dir;
      case "observacion":
        return (
          colator.compare(
            ANTICIPOS_OBSERVACION_1_LABELS[a.observacion_1],
            ANTICIPOS_OBSERVACION_1_LABELS[b.observacion_1],
          ) * dir
        );
      case "fecha_rq":
        return a.fecha_rq.localeCompare(b.fecha_rq) * dir;
      case "fecha_gestion":
        return compararNullable(a.fecha_gestion, b.fecha_gestion, (x, y) => x.localeCompare(y), dir);
    }
  };
  // Empate: se respeta el orden del semáforo (sort es estable).
  return [...filas].sort(cmp);
}

/** asc → desc → orden por defecto. */
function siguienteOrden(actual: Orden, id: Exclude<ColumnaId, "accion">): Orden {
  if (actual?.id !== id) return { id, dir: "asc" };
  if (actual.dir === "asc") return { id, dir: "desc" };
  return null;
}

// ─── Tabla ───

export function AnticiposTabla({
  filas,
  seguimientos,
  soloLectura,
  orden,
  onOrden,
  onAbrir,
}: {
  /** Ya filtradas, ordenadas y recortadas al límite visible. */
  filas: AnticipoRow[];
  seguimientos: Map<string, Seguimiento>;
  soloLectura: boolean;
  orden: Orden;
  onOrden: (orden: Orden) => void;
  onAbrir: (id: string) => void;
}) {
  const columnas = useMemo(() => (soloLectura ? COLUMNAS.filter((c) => c.id !== "accion") : COLUMNAS), [soloLectura]);
  const [pesos, setPesos] = useState<Record<ColumnaId, number>>(PESOS_DEFAULT);
  const tablaRef = useRef<HTMLTableElement>(null);

  // localStorage solo existe en el navegador: se lee después de hidratar.
  useEffect(() => {
    setPesos(cargarPesos());
  }, []);

  const total = columnas.reduce((acc, c) => acc + pesos[c.id], 0);

  /**
   * Mover el borde entre la columna `i` y la siguiente pasa ancho de una a la otra: el total no
   * cambia, así que la tabla siempre ocupa exactamente el ancho disponible (sin scroll horizontal).
   */
  const redimensionar = useCallback(
    (i: number, deltaPx: number, base: Record<ColumnaId, number>): Record<ColumnaId, number> => {
      const ancho = tablaRef.current?.offsetWidth ?? 0;
      const a = columnas[i];
      const b = columnas[i + 1];
      if (!ancho || !a || !b) return base;
      const totalBase = columnas.reduce((acc, c) => acc + base[c.id], 0);
      const pxPorPeso = ancho / totalBase;
      const minA = a.min / pxPorPeso;
      const minB = b.min / pxPorPeso;
      const par = base[a.id] + base[b.id];
      let nuevoA = base[a.id] + deltaPx / pxPorPeso;
      nuevoA = Math.min(Math.max(nuevoA, minA), par - minB);
      if (par - minB < minA) return base;
      return { ...base, [a.id]: nuevoA, [b.id]: par - nuevoA };
    },
    [columnas],
  );

  function iniciarArrastre(e: React.PointerEvent<HTMLDivElement>, i: number) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const inicioX = e.clientX;
    const base = pesos;
    let ultimo = base;

    const mover = (ev: PointerEvent) => {
      ultimo = redimensionar(i, ev.clientX - inicioX, base);
      setPesos(ultimo);
    };
    const soltar = () => {
      handle.removeEventListener("pointermove", mover);
      handle.removeEventListener("pointerup", soltar);
      handle.removeEventListener("pointercancel", soltar);
      document.body.style.removeProperty("cursor");
      guardarPesos(ultimo);
    };
    document.body.style.cursor = "col-resize";
    handle.addEventListener("pointermove", mover);
    handle.addEventListener("pointerup", soltar);
    handle.addEventListener("pointercancel", soltar);
  }

  function teclaRedimensionar(e: React.KeyboardEvent<HTMLDivElement>, i: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const siguiente = redimensionar(i, e.key === "ArrowRight" ? 16 : -16, pesos);
    setPesos(siguiente);
    guardarPesos(siguiente);
  }

  function restablecer() {
    setPesos(PESOS_DEFAULT);
    guardarPesos(PESOS_DEFAULT);
  }

  return (
    <Table ref={tablaRef} className="min-w-[720px] table-fixed">
      <colgroup>
        {columnas.map((c) => (
          <col key={c.id} style={{ width: `${(pesos[c.id] / total) * 100}%` }} />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columnas.map((c, i) => {
            const activo = orden?.id === c.id;
            const esUltima = i === columnas.length - 1;
            return (
              <TableHead
                key={c.id}
                aria-sort={activo ? (orden.dir === "asc" ? "ascending" : "descending") : undefined}
                className={cn("relative select-none", c.align === "right" && "text-right")}
              >
                {c.ordenable && c.id !== "accion" ? (
                  <button
                    type="button"
                    onClick={() => onOrden(siguienteOrden(orden, c.id as Exclude<ColumnaId, "accion">))}
                    className={cn(
                      "-mx-1 inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 uppercase tracking-wide transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      c.align === "right" && "flex-row-reverse",
                      activo && "text-foreground",
                    )}
                    title={`Ordenar por ${c.titulo.toLowerCase()}`}
                  >
                    <span className="truncate">{c.titulo}</span>
                    {activo ? (
                      orden.dir === "asc" ? (
                        <ArrowUp className="size-3 shrink-0" />
                      ) : (
                        <ArrowDown className="size-3 shrink-0" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3 shrink-0 opacity-40" />
                    )}
                  </button>
                ) : (
                  <span className="block truncate">{c.titulo}</span>
                )}
                {!esUltima && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Ajustar ancho de ${c.titulo} (flechas izquierda/derecha; doble clic restablece)`}
                    tabIndex={0}
                    onPointerDown={(e) => iniciarArrastre(e, i)}
                    onKeyDown={(e) => teclaRedimensionar(e, i)}
                    onDoubleClick={restablecer}
                    className="group/resize absolute inset-y-0 -right-1.5 z-10 flex w-3 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
                  >
                    <span
                      aria-hidden
                      className="h-4 w-px bg-border transition-colors group-hover/resize:h-full group-hover/resize:bg-primary/60 group-focus-visible/resize:h-full group-focus-visible/resize:bg-primary"
                    />
                  </div>
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {filas.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columnas.length} className="py-10 text-center text-sm text-muted-foreground">
              No hay registros con estos filtros.
            </TableCell>
          </TableRow>
        ) : (
          filas.map((r, i) => (
            <Fila
              key={r.id}
              row={r}
              seguimiento={seguimientos.get(r.id)!}
              soloLectura={soloLectura}
              tour={i === 0}
              onAbrir={onAbrir}
            />
          ))
        )}
      </TableBody>
    </Table>
  );
}

/**
 * Memo: al arrastrar un borde de columna (`setPesos` en cada pointermove), al abrir la sheet o al
 * escribir en el buscador, la tabla se vuelve a pintar; sin memo, cada fila también. Las props son
 * estables: `row` y `seguimiento` salen de memos del padre y `onAbrir` es un useCallback.
 */
const Fila = memo(function Fila({
  row: r,
  seguimiento,
  soloLectura,
  tour,
  onAbrir,
}: {
  row: AnticipoRow;
  seguimiento: Seguimiento;
  soloLectura: boolean;
  /** La primera fila es la que señala el recorrido "¿Cómo usar?". */
  tour: boolean;
  onAbrir: (id: string) => void;
}) {
  const celda = "overflow-hidden py-2.5";
  return (
    <TableRow
      tabIndex={0}
      data-tour={tour ? "fila" : undefined}
      aria-label={`${r.nombre}, requerimiento ${r.requerimiento}: ${seguimiento.motivo}`}
      className="cursor-pointer outline-none focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={() => onAbrir(r.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onAbrir(r.id);
      }}
    >
      <TableCell className={celda}>
        <AlertaIndicador alerta={seguimiento} etiquetas={NIVEL_SEGUIMIENTO_LABEL} />
      </TableCell>
      <TableCell className={celda}>
        <div className="flex min-w-0 items-center gap-1.5">
          <p
            className={cn("truncate font-semibold", r.es_retirado ? "text-muted-foreground" : "text-foreground")}
            title={r.nombre}
          >
            {r.nombre}
          </p>
          {r.es_retirado && <ExcolaboradorChip parcial={r.retiro_info?.nivel === "parcial"} />}
        </div>
        <p className="truncate font-mono text-xs text-muted-foreground" title={r.requerimiento}>
          {r.requerimiento}
        </p>
      </TableCell>
      <TableCell className={cn(celda, "truncate text-right font-mono text-sm tabular-nums")}>
        {formatAnticipoCurrency(r.valor) ?? <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className={celda}>
        <FaltaBadge value={r.falta} />
      </TableCell>
      <TableCell className={celda}>
        <ObservacionBadge value={r.observacion_1} />
        {r.observacion_2 && (
          <p className="mt-1 truncate text-xs text-muted-foreground" title={r.observacion_2}>
            {r.observacion_2}
          </p>
        )}
      </TableCell>
      <TableCell className={cn(celda, "truncate font-mono text-xs tabular-nums text-muted-foreground")}>
        {formatAnticipoFecha(r.fecha_rq)}
      </TableCell>
      <TableCell className={cn(celda, "truncate font-mono text-xs tabular-nums text-muted-foreground")}>
        {formatAnticipoFecha(r.fecha_gestion)}
      </TableCell>
      {!soloLectura && (
        <TableCell className={cn(celda, "text-right")}>
          {/* En columnas angostas el botón queda solo con el ícono. */}
          <div className="@container flex justify-end">
            <LegalizarBoton row={r} variant="outline" compacto />
          </div>
        </TableCell>
      )}
    </TableRow>
  );
});

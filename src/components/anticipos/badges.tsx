import { CircleAlert, UserMinus } from "lucide-react";

import {
  ANTICIPOS_FALTA_LABELS,
  ANTICIPOS_OBSERVACION_1_LABELS,
  type AnticipoFalta,
  type AnticipoObservacion1,
} from "@/lib/anticipos/schema";
import { cn } from "@/lib/utils";

/** Mismo formato que `EstadoBadge` de servicios públicos: borde neutro y punto de color. */
const BADGE =
  "inline-flex max-w-full items-center whitespace-nowrap rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground";

function dotFalta(value: AnticipoFalta): string {
  if (value === "legalizado") return "bg-emerald-500";
  if (value === "devolucion") return "bg-amber-500";
  if (value === "revisar_con_harold" || value === "revisar_soportes" || value === "revisar_descuento_nomina") {
    return "bg-sky-500";
  }
  return "bg-muted-foreground";
}

function dotObservacion(value: AnticipoObservacion1): string {
  if (value === "legalizado") return "bg-emerald-500";
  if (value === "correo_al_lider") return "bg-sky-500";
  if (value === "escrito_3_veces") return "bg-amber-500";
  return "bg-muted-foreground";
}

export function FaltaBadge({ value, className }: { value: AnticipoFalta; className?: string }) {
  return (
    <span className={cn(BADGE, className)} title={ANTICIPOS_FALTA_LABELS[value]}>
      <span aria-hidden className={cn("mr-1.5 size-1.5 shrink-0 rounded-full", dotFalta(value))} />
      <span className="truncate">{ANTICIPOS_FALTA_LABELS[value]}</span>
    </span>
  );
}

export function ObservacionBadge({ value, className }: { value: AnticipoObservacion1; className?: string }) {
  return (
    <span className={cn(BADGE, className)} title={ANTICIPOS_OBSERVACION_1_LABELS[value]}>
      <span aria-hidden className={cn("mr-1.5 size-1.5 shrink-0 rounded-full", dotObservacion(value))} />
      <span className="truncate">{ANTICIPOS_OBSERVACION_1_LABELS[value]}</span>
    </span>
  );
}

/** `parcial`: el nombre coincide solo en parte con el reporte de Contabilidad. */
export function ExcolaboradorChip({ parcial = false }: { parcial?: boolean }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-1.5 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
      {parcial && <CircleAlert className="size-3 text-amber-600 dark:text-amber-400" aria-label="Coincidencia parcial" />}
      <UserMinus className="size-3" aria-hidden />
      <span className="text-[10px] font-semibold uppercase tracking-wider">Excolaborador</span>
    </span>
  );
}

"use client";

import { Filter } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMediaQuery } from "@/hooks/use-media-query";
import { NIVEL_ALERTA_LABEL, type Alerta, type NivelAlerta } from "@/lib/servicios-publicos/alertas";
import { ESTADO_CORTO, type EstadoRecibo } from "@/lib/servicios-publicos/schema";
import { cn } from "@/lib/utils";

/** Colores del semáforo. Definidos una vez; siempre van con texto, nunca solos. */
export const TONO_ALERTA: Record<NivelAlerta, { dot: string; chip: string; text: string }> = {
  ok: {
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  atencion: {
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40",
    text: "text-amber-700 dark:text-amber-300",
  },
  revisar: {
    dot: "bg-rose-500",
    chip: "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40",
    text: "text-rose-700 dark:text-rose-300",
  },
};

const TONO_ESTADO: Record<EstadoRecibo, string> = {
  pendiente_factura: "bg-muted-foreground",
  recibido: "bg-sky-500",
  registrado: "bg-amber-500",
  pagado: "bg-emerald-500",
};

export function EstadoBadge({ estado, className }: { estado: EstadoRecibo; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      <span aria-hidden className={cn("mr-1.5 size-1.5 shrink-0 rounded-full", TONO_ESTADO[estado])} />
      {ESTADO_CORTO[estado]}
    </span>
  );
}

/** Semáforo: punto + nivel + motivo. */
export function AlertaIndicador({
  alerta,
  compacto = false,
  etiquetas = NIVEL_ALERTA_LABEL,
}: {
  alerta: Alerta;
  compacto?: boolean;
  /** Nombres de los niveles; por defecto los de servicios públicos. */
  etiquetas?: Record<NivelAlerta, string>;
}) {
  const tono = TONO_ALERTA[alerta.nivel];
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", tono.text)}>
        <span aria-hidden className={cn("size-2 shrink-0 rounded-full", tono.dot)} />
        {etiquetas[alerta.nivel]}
      </span>
      {!compacto && <span className="truncate text-xs text-muted-foreground">{alerta.motivo}</span>}
    </div>
  );
}

export const TODOS = "__todos__";

export function FiltroSelect({
  label,
  value,
  onChange,
  options,
  todosLabel = "Todos",
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  todosLabel?: string;
  className?: string;
}) {
  const activo = value !== TODOS;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-9 w-full gap-1.5 overflow-hidden text-xs font-normal shadow-none sm:w-44",
          activo && "border-primary/40 bg-primary/5 text-foreground ring-1 ring-primary/20",
          className,
        )}
      >
        <Filter className={cn("size-3 shrink-0", activo ? "text-primary" : "text-muted-foreground")} />
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-left">
          <span className="shrink-0 text-muted-foreground">{label}:</span>
          <SelectValue placeholder={todosLabel} />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TODOS}>{todosLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Rol "Label" de DESIGN.md (11px, semibold, mayúsculas, tracking 0.06em). Único en todo el módulo. */
export const ETIQUETA = "text-[0.6875rem] font-semibold uppercase leading-none tracking-[0.06em] text-muted-foreground";

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn(ETIQUETA, className)}>{children}</span>;
}

export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {children}
    </p>
  );
}

/**
 * Ventana del módulo: diálogo centrado en escritorio y hoja inferior (Drawer) bajo 768px,
 * como pide DESIGN.md. Cabecera fija; el contenido (`children`) maneja su scroll y su pie.
 */
export function Ventana({
  open,
  onOpenChange,
  titulo,
  descripcion,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titulo: React.ReactNode;
  descripcion?: React.ReactNode;
  /** Ancho en escritorio, p. ej. `sm:max-w-xl`. */
  className?: string;
  children: React.ReactNode;
}) {
  const escritorio = useMediaQuery("(min-width: 768px)");

  if (escritorio) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn("flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0", className)}>
          <DialogHeader className="shrink-0 gap-1 border-b border-border px-5 pb-4 pt-5 pr-12">
            <DialogTitle>{titulo}</DialogTitle>
            {descripcion && <DialogDescription>{descripcion}</DialogDescription>}
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh] overflow-hidden">
        <DrawerHeader className="shrink-0 border-b border-border">
          <DrawerTitle>{titulo}</DrawerTitle>
          {descripcion && <DrawerDescription>{descripcion}</DrawerDescription>}
        </DrawerHeader>
        {children}
      </DrawerContent>
    </Drawer>
  );
}

/** Pie fijo de una Ventana: acciones a la derecha en escritorio, apiladas en móvil. */
export function PieVentana({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-card px-5 py-3 sm:flex-row sm:justify-end",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type TonoIndicador = "default" | "success" | "warning" | "destructive" | "muted";

const TONO_INDICADOR: Record<TonoIndicador, string> = {
  default: "bg-primary/10 text-primary border-primary/15 dark:bg-primary/15 dark:text-primary-foreground/90 dark:border-primary/30",
  success: "bg-emerald-100 text-emerald-700 border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40",
  warning: "bg-amber-100 text-amber-700 border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40",
  destructive: "bg-rose-100 text-rose-700 border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40",
  muted: "bg-muted text-muted-foreground border-border",
};

/** KPI como botón: al hacer clic filtra la tabla. Lo usan servicios públicos y anticipos. */
export function Indicador({
  icon,
  label,
  value,
  tone,
  detalle,
  activo,
  onClick,
  accion,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: TonoIndicador;
  detalle?: string;
  activo: boolean;
  onClick: () => void;
  /** Acción secundaria al pie de la tarjeta (p. ej. "Actualizar reporte →"). Va fuera del botón de filtro. */
  accion?: React.ReactNode;
}) {
  const marco = cn(
    "rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40",
    activo ? "border-primary ring-1 ring-primary/30" : "border-border",
  );
  const contenido = (
    <>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-md border", TONO_INDICADOR[tone])} aria-hidden>
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn(ETIQUETA, "truncate py-px")}>{label}</span>
        <span className="font-mono text-xl font-semibold tabular-nums text-foreground">{value}</span>
        {detalle && <span className="truncate text-xs text-muted-foreground">{detalle}</span>}
      </span>
    </>
  );

  if (!accion) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={activo}
        className={cn(marco, "flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
      >
        {contenido}
      </button>
    );
  }

  return (
    <div className={cn(marco, "flex flex-col gap-2")}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={activo}
        className="-m-1 flex items-center gap-3 rounded-md p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {contenido}
      </button>
      <div className="flex justify-end">{accion}</div>
    </div>
  );
}

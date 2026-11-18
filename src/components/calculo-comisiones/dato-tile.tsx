"use client";

import { Check, ChevronDown, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { TONO_GRUPO, type TonoGrupo } from "./grupo";

export type EstadoDato = "listo" | "falta" | "leyendo";

interface DatoTileProps {
  id: string;
  titulo: React.ReactNode;
  tipo: TonoGrupo;
  estado: EstadoDato;
  /** Es el próximo dato que falta: se señaliza en ámbar. */
  siguiente: boolean;
  /** Cifra principal (o nombre del archivo). */
  valor?: string;
  /** El valor es texto, no una cifra. */
  valorTexto?: boolean;
  detalle: string;
  /** Texto del botón; se marca como acción principal si falta el dato. */
  accion: string;
  abierto: boolean;
  onToggle: () => void;
}

const TIPO_LABEL: Record<TonoGrupo, string> = { gasto: "Gasto", ingreso: "Ingreso" };

/** Uno de los tres datos que el mes necesita, con su estado y su cifra. */
export function DatoTile({
  id,
  titulo,
  tipo,
  estado,
  siguiente,
  valor,
  valorTexto,
  detalle,
  accion,
  abierto,
  onToggle,
}: DatoTileProps) {
  return (
    <div
      data-tour={`dato-${id}`}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm transition-colors",
        abierto ? "border-primary ring-1 ring-primary" : siguiente ? "border-amber-400 dark:border-amber-500/70" : "border-border",
        estado === "falta" && !abierto && !siguiente && "border-dashed bg-card/60 shadow-none",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">{titulo}</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span aria-hidden className={cn("size-1.5 rounded-full", TONO_GRUPO[tipo].dot)} />
            {TIPO_LABEL[tipo]}
          </span>
        </div>
        <EstadoChip estado={estado} />
      </div>

      <div className="flex min-h-12 flex-col justify-end">
        {valor ? (
          <span
            className={cn(
              "truncate font-semibold",
              valorTexto ? "text-sm" : "font-mono text-lg tabular-nums",
            )}
          >
            {valor}
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">{detalle}</span>
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierto}
        aria-controls="dato-editor"
        className={cn(
          "inline-flex h-8 items-center justify-center gap-1.5 self-start rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          estado === "falta" && !abierto
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "border border-border bg-background hover:bg-muted",
        )}
      >
        {abierto ? "Cerrar" : accion}
        <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", abierto && "rotate-180")} />
      </button>
    </div>
  );
}

function EstadoChip({ estado }: { estado: EstadoDato }) {
  if (estado === "listo") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
        <Check aria-hidden className="size-3" strokeWidth={3} />
        Listo
      </span>
    );
  }
  if (estado === "leyendo") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
        <Loader2 aria-hidden className="size-3 animate-spin" />
        Leyendo
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
      Falta
    </span>
  );
}

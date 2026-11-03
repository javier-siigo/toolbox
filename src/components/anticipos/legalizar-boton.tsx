"use client";

import { useTransition } from "react";
import { BadgeCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { legalizeAnticipo } from "@/lib/anticipos/actions";
import type { AnticipoRow } from "@/lib/anticipos/schema";
import { cn } from "@/lib/utils";

/**
 * El "siguiente paso" de un anticipo pendiente. En la tabla va `outline`: un botón azul por
 * fila rompería la regla de un solo primario por vista. Nada si ya está legalizado.
 */
export function LegalizarBoton({
  row,
  variant = "default",
  compacto = false,
  className,
}: {
  row: AnticipoRow;
  variant?: "default" | "outline";
  /** Dentro de un `@container` angosto (< 7rem) muestra solo el ícono. */
  compacto?: boolean;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();

  if (row.falta === "legalizado") return null;

  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className={cn(compacto && "@max-[7rem]:px-2", className)}
      disabled={pending}
      aria-label={compacto ? "Legalizar anticipo" : undefined}
      title={compacto ? "Legalizar anticipo" : undefined}
      onClick={(e) => {
        e.stopPropagation();
        startTransition(async () => {
          const res = await legalizeAnticipo(row.id);
          if (res.error) toast.error(res.error);
          else toast.success("Anticipo legalizado");
        });
      }}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <BadgeCheck className="size-3.5" />}
      <span className={cn(compacto && "@max-[7rem]:sr-only")}>{pending ? "Legalizando…" : "Legalizar"}</span>
    </Button>
  );
}

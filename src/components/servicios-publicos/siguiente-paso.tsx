"use client";

import { CheckCircle2, FileInput, Send, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Recibo } from "@/lib/servicios-publicos/schema";

export type AccionRecibo =
  | { tipo: "editar"; recibo: Recibo }
  | { tipo: "factura"; recibo: Recibo }
  | { tipo: "registrar"; recibo: Recibo }
  | { tipo: "pagar"; recibo: Recibo }
  | { tipo: "soporte"; recibo: Recibo };

/**
 * El único botón de "qué sigue" de un recibo. Lo usan la tabla y el detalle.
 * En la tabla va `outline`: un botón azul por fila rompería la regla de un solo primario por vista.
 */
export function SiguientePaso({
  recibo,
  onAccion,
  variant = "default",
  className,
}: {
  recibo: Recibo;
  onAccion: (accion: AccionRecibo) => void;
  variant?: "default" | "outline";
  className?: string;
}) {
  const boton = (tipo: AccionRecibo["tipo"], label: string, icon: React.ReactNode) => (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        onAccion({ tipo, recibo });
      }}
    >
      {icon}
      {label}
    </Button>
  );

  switch (recibo.estado) {
    case "pendiente_factura":
      return boton("factura", "Llegó la factura", <FileInput className="size-3.5" />);
    case "recibido":
      return boton("registrar", "Registrar", <Send className="size-3.5" />);
    case "registrado":
      return boton("pagar", "Marcar pagado", <CheckCircle2 className="size-3.5" />);
    case "pagado":
      return recibo.soporte_nombre ? null : boton("soporte", "Adjuntar soporte", <Upload className="size-3.5" />);
  }
}

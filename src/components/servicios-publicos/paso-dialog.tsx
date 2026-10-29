"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { marcarPaso } from "@/lib/servicios-publicos/actions";
import { SOPORTE_ACCEPT, formatValor, type Recibo } from "@/lib/servicios-publicos/schema";

import { PieVentana, Ventana } from "./bits";
import { subirSoporte } from "./subir-soporte";

export type Paso = { tipo: "registrar" | "pagar"; recibo: Recibo };

const TEXTO = {
  registrar: {
    titulo: "Registrar recibo",
    descripcion: "Confirma que lo registraste y lo enviaste a Tesorería. Quedará pendiente de pago.",
    fecha: "Fecha de registro",
    boton: "Registrar",
  },
  pagar: {
    titulo: "Marcar como pagado",
    descripcion: "Confirma que Tesorería ya pagó este recibo.",
    fecha: "Fecha de pago",
    boton: "Marcar pagado",
  },
} as const;

export function PasoDialog({ paso, onClose, hoy }: { paso: Paso | null; onClose: () => void; hoy: string }) {
  return (
    <Ventana
      open={paso !== null}
      onOpenChange={(open) => !open && onClose()}
      className="sm:max-w-md"
      titulo={paso ? TEXTO[paso.tipo].titulo : ""}
      descripcion={paso && TEXTO[paso.tipo].descripcion}
    >
      {paso && <Contenido key={`${paso.tipo}-${paso.recibo.id}`} paso={paso} onClose={onClose} hoy={hoy} />}
    </Ventana>
  );
}

function Contenido({ paso, onClose, hoy }: { paso: Paso; onClose: () => void; hoy: string }) {
  const { recibo } = paso;
  const texto = TEXTO[paso.tipo];
  const minimo = (paso.tipo === "registrar" ? recibo.fecha_recibido : recibo.fecha_registro) ?? undefined;
  const [fecha, setFecha] = useState(hoy);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmar() {
    if (!fecha) return setError("Indica la fecha.");
    if (minimo && fecha < minimo) {
      return setError(
        paso.tipo === "registrar"
          ? "No puede ser anterior a la llegada de la factura."
          : "No puede ser anterior al registro.",
      );
    }
    setError(null);
    startTransition(async () => {
      const res = await marcarPaso(recibo.id, paso.tipo, fecha);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (paso.tipo === "pagar" && archivo) {
        const subida = await subirSoporte(recibo.id, archivo);
        if (!subida.ok) {
          // El pago sí quedó guardado: se dice explícitamente para que no se repita.
          toast.warning("Pago guardado, pero el soporte no se subió", {
            description: `${subida.error} Adjúntalo desde el detalle del recibo.`,
            duration: 10_000,
          });
          onClose();
          return;
        }
        toast.success("Pagado y con soporte");
      } else {
        toast.success(paso.tipo === "pagar" ? "Recibo marcado como pagado" : "Recibo registrado");
      }
      onClose();
    });
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <dt className="text-muted-foreground">Servicio</dt>
          <dd className="font-medium">
            {recibo.proveedor} · {recibo.servicio}
          </dd>
          <dt className="text-muted-foreground">Referencia</dt>
          <dd className="font-mono">{recibo.referencia ?? "—"}</dd>
          <dt className="text-muted-foreground">Valor</dt>
          <dd className="font-mono tabular-nums">{formatValor(recibo.valor)}</dd>
        </dl>

        <div className="space-y-1.5">
          <Label htmlFor="paso-fecha">{texto.fecha}</Label>
          <Input
            id="paso-fecha"
            type="date"
            value={fecha}
            min={minimo}
            onChange={(e) => setFecha(e.target.value)}
            className="font-mono tabular-nums"
          />
        </div>

        {paso.tipo === "pagar" && (
          <div className="space-y-1.5">
            <Label htmlFor="paso-soporte">
              Soporte de pago <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="paso-soporte"
              type="file"
              accept={SOPORTE_ACCEPT}
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-muted-foreground">PDF o imagen, máx. 10 MB. Si aún no lo tienes, adjúntalo después.</p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <PieVentana>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="button" onClick={confirmar} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {texto.boton}
        </Button>
      </PieVentana>
    </>
  );
}

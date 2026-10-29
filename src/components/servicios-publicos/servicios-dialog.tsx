"use client";

import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2, Pencil, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  cambiarActivoServicio,
  guardarServicio,
  type GuardarServicioState,
} from "@/lib/servicios-publicos/actions";
import {
  TIPOS_SERVICIO,
  servicioSchema,
  type Servicio,
  type ServicioField,
  type ServicioInput,
} from "@/lib/servicios-publicos/schema";
import { cn } from "@/lib/utils";

import { FieldError, PieVentana, Ventana } from "./bits";

type Vista = { tipo: "lista" } | { tipo: "form"; servicio: Servicio | null };

export function ServiciosDialog({
  open,
  onOpenChange,
  servicios,
  soloLectura,
  nuevoAlAbrir = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servicios: Servicio[];
  soloLectura: boolean;
  /** Abre directo el formulario (desde el estado vacío). */
  nuevoAlAbrir?: boolean;
}) {
  const [vista, setVista] = useState<Vista>({ tipo: "lista" });
  useEffect(() => {
    if (open) setVista(nuevoAlAbrir ? { tipo: "form", servicio: null } : { tipo: "lista" });
  }, [open, nuevoAlAbrir]);

  return (
    <Ventana
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-2xl"
      titulo={vista.tipo === "lista" ? "Servicios" : vista.servicio ? "Editar servicio" : "Nuevo servicio"}
      descripcion={
        vista.tipo === "lista"
          ? "Los servicios activos son los recibos que se esperan cada mes. Los inactivos conservan su histórico."
          : "Con el día de corte, el portal te avisa cuando una factura debería haber llegado."
      }
    >
      {vista.tipo === "lista" ? (
        <Lista
          servicios={servicios}
          soloLectura={soloLectura}
          onNuevo={() => setVista({ tipo: "form", servicio: null })}
          onEditar={(s) => setVista({ tipo: "form", servicio: s })}
        />
      ) : (
        <Formulario
          key={vista.servicio?.id ?? "nuevo"}
          servicio={vista.servicio}
          onVolver={() => (nuevoAlAbrir && !vista.servicio ? onOpenChange(false) : setVista({ tipo: "lista" }))}
        />
      )}
    </Ventana>
  );
}

function Lista({
  servicios,
  soloLectura,
  onNuevo,
  onEditar,
}: {
  servicios: Servicio[];
  soloLectura: boolean;
  onNuevo: () => void;
  onEditar: (s: Servicio) => void;
}) {
  const [pendienteId, setPendienteId] = useState<string | null>(null);
  const [pending, startToggle] = useTransition();

  function toggle(s: Servicio) {
    setPendienteId(s.id);
    startToggle(async () => {
      const res = await cambiarActivoServicio(s.id, !s.activo);
      if (res.error) toast.error(res.error);
      else toast.success(s.activo ? "Servicio desactivado" : "Servicio activado");
    });
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {servicios.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aún no hay servicios.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {servicios.map((s) => (
              <li key={s.id} className={cn("flex items-center gap-3 px-3 py-2.5", !s.activo && "bg-muted/40")}>
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-semibold", !s.activo && "text-muted-foreground")}>
                    {s.proveedor} · {s.servicio}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {s.referencia ?? "Sin referencia"} · {s.dia_corte ? `corte día ${s.dia_corte}` : "sin día de corte"}
                  </p>
                </div>
                {!s.activo && <span className="text-xs font-medium text-muted-foreground">Inactivo</span>}
                {!soloLectura && (
                  <>
                    <Button type="button" variant="ghost" size="sm" onClick={() => toggle(s)} disabled={pending}>
                      {pending && pendienteId === s.id && <Loader2 className="size-3.5 animate-spin" />}
                      {s.activo ? "Desactivar" : "Activar"}
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Editar ${s.proveedor}`} onClick={() => onEditar(s)}>
                      <Pencil className="size-3.5" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {!soloLectura && (
        <PieVentana>
          <Button type="button" onClick={onNuevo}>
            <Plus className="size-4" />
            Agregar servicio
          </Button>
        </PieVentana>
      )}
    </>
  );
}

function Formulario({ servicio, onVolver }: { servicio: Servicio | null; onVolver: () => void }) {
  const [state, formAction, pending] = useActionState<GuardarServicioState | undefined, FormData>(
    guardarServicio,
    undefined,
  );
  const form = useForm<ServicioInput>({
    resolver: zodResolver(servicioSchema),
    mode: "onTouched",
    defaultValues: {
      id: servicio?.id ?? "",
      proveedor: servicio?.proveedor ?? "",
      servicio: servicio?.servicio ?? "",
      referencia: servicio?.referencia ?? "",
      dia_corte: servicio?.dia_corte ? String(servicio.dia_corte) : "",
      notas: servicio?.notas ?? "",
    },
  });
  const { register, handleSubmit, setError, formState } = form;

  // Cada respuesta del servidor se procesa una sola vez, aunque el efecto se repita.
  const procesado = useRef<typeof state>(undefined);
  useEffect(() => {
    if (!state || procesado.current === state) return;
    procesado.current = state;
    if (state.fieldErrors) {
      for (const [key, message] of Object.entries(state.fieldErrors)) {
        if (message) setError(key as ServicioField, { message });
      }
    }
    if (state.error && !state.fieldErrors) toast.error(state.error);
    if (state.ok) {
      toast.success(servicio ? "Servicio actualizado" : "Servicio agregado");
      onVolver();
    }
  }, [state, setError, onVolver, servicio]);

  function onValid(values: ServicioInput) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v ?? "");
    startTransition(() => formAction(fd));
  }

  const err = (k: ServicioField) => formState.errors[k]?.message;

  return (
    <form onSubmit={handleSubmit(onValid)} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="servicio-proveedor">Proveedor</Label>
            <Input id="servicio-proveedor" placeholder="Ej. Enel" autoComplete="off" aria-invalid={Boolean(err("proveedor"))} {...register("proveedor")} />
            {err("proveedor") && <FieldError id="servicio-proveedor-error">{err("proveedor")}</FieldError>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="servicio-tipo">Servicio</Label>
            <Input id="servicio-tipo" list="servicio-tipos" placeholder="Ej. Energía" autoComplete="off" aria-invalid={Boolean(err("servicio"))} {...register("servicio")} />
            <datalist id="servicio-tipos">
              {TIPOS_SERVICIO.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            {err("servicio") && <FieldError id="servicio-tipo-error">{err("servicio")}</FieldError>}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="servicio-referencia">
              Referencia / número de cuenta <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input id="servicio-referencia" className="font-mono" autoComplete="off" aria-invalid={Boolean(err("referencia"))} {...register("referencia")} />
            {err("referencia") ? (
              <FieldError id="servicio-referencia-error">{err("referencia")}</FieldError>
            ) : (
              <p className="text-xs text-muted-foreground">Se copia a cada recibo; puedes cambiarla allí.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="servicio-corte">
              Día de corte <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Input id="servicio-corte" inputMode="numeric" placeholder="1 a 31" className="font-mono tabular-nums" aria-invalid={Boolean(err("dia_corte"))} {...register("dia_corte")} />
            {err("dia_corte") ? (
              <FieldError id="servicio-corte-error">{err("dia_corte")}</FieldError>
            ) : (
              <p className="text-xs text-muted-foreground">Día del mes en que se espera la factura.</p>
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="servicio-notas">
            Notas <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea id="servicio-notas" rows={2} maxLength={500} placeholder="Ej. sede, cómo se descarga la factura…" {...register("notas")} />
          {err("notas") && <FieldError id="servicio-notas-error">{err("notas")}</FieldError>}
        </div>
      </div>
      <PieVentana className="sm:justify-between">
        <Button type="button" variant="ghost" onClick={onVolver} disabled={pending}>
          <ArrowLeft className="size-4" />
          Volver
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {pending ? "Guardando…" : "Guardar servicio"}
        </Button>
      </PieVentana>
    </form>
  );
}

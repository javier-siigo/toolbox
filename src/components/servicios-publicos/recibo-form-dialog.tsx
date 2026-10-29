"use client";

import { startTransition, useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Controller, useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  guardarRecibo,
  guardarServicio,
  type GuardarReciboState,
} from "@/lib/servicios-publicos/actions";
import {
  TIPOS_SERVICIO,
  corteDelMes,
  reciboSchema,
  servicioSchema,
  type Recibo,
  type ReciboField,
  type ReciboInput,
  type Servicio,
} from "@/lib/servicios-publicos/schema";

import { FieldError, PieVentana, SectionLabel, Ventana } from "./bits";

/** `factura`: se abre desde "Llegó la factura" y precarga las fechas de hoy. */
export type ModoFormulario = { tipo: "nuevo" } | { tipo: "editar"; recibo: Recibo } | { tipo: "factura"; recibo: Recibo };

function valoresIniciales(modo: ModoFormulario, mes: string, hoy: string): ReciboInput {
  if (modo.tipo === "nuevo") {
    return {
      id: "",
      servicio_id: "",
      mes,
      referencia: "",
      valor: "",
      fecha_corte: "",
      fecha_recibido: hoy,
      fecha_registro: hoy,
      fecha_pago: "",
      observaciones: "",
    };
  }
  const r = modo.recibo;
  const llega = modo.tipo === "factura";
  return {
    id: r.id,
    servicio_id: r.servicio_id,
    mes: r.mes,
    referencia: r.referencia ?? "",
    valor: r.valor === null ? "" : String(r.valor),
    fecha_corte: r.fecha_corte ?? "",
    fecha_recibido: r.fecha_recibido ?? (llega ? hoy : ""),
    fecha_registro: r.fecha_registro ?? (llega ? hoy : ""),
    fecha_pago: r.fecha_pago ?? "",
    observaciones: r.observaciones ?? "",
  };
}

const TITULO: Record<ModoFormulario["tipo"], string> = {
  nuevo: "Nuevo recibo",
  editar: "Editar recibo",
  factura: "Llegó la factura",
};

const DESCRIPCION: Record<ModoFormulario["tipo"], string> = {
  nuevo: "Registra el recibo. Si aún no lo envías a Tesorería, deja vacía la fecha de registro.",
  editar: "El estado se actualiza solo según las fechas que llenes.",
  factura: "Completa el valor y la referencia. Al guardar queda registrado y pendiente de pago.",
};

export function ReciboFormDialog({
  modo,
  onClose,
  servicios,
  mesInicial,
  hoy,
}: {
  /** `null` = cerrado. */
  modo: ModoFormulario | null;
  onClose: () => void;
  servicios: Servicio[];
  mesInicial: string;
  hoy: string;
}) {
  return (
    <Ventana
      open={modo !== null}
      onOpenChange={(open) => !open && onClose()}
      className="sm:max-w-xl"
      titulo={modo ? TITULO[modo.tipo] : ""}
      descripcion={
        modo && (
          <>
            {modo.tipo !== "nuevo" && (
              <span className="font-medium text-foreground">
                {modo.recibo.proveedor} · {modo.recibo.servicio}.{" "}
              </span>
            )}
            {DESCRIPCION[modo.tipo]}
          </>
        )
      }
    >
      {modo && (
        <Formulario
          key={modo.tipo === "nuevo" ? "nuevo" : `${modo.tipo}-${modo.recibo.id}`}
          modo={modo}
          onClose={onClose}
          servicios={servicios}
          valores={valoresIniciales(modo, mesInicial, hoy)}
          hoy={hoy}
        />
      )}
    </Ventana>
  );
}

function Formulario({
  modo,
  onClose,
  servicios,
  valores,
  hoy,
}: {
  modo: ModoFormulario;
  onClose: () => void;
  servicios: Servicio[];
  valores: ReciboInput;
  hoy: string;
}) {
  const [state, formAction, pending] = useActionState<GuardarReciboState | undefined, FormData>(
    guardarRecibo,
    undefined,
  );
  const form = useForm<ReciboInput>({
    resolver: zodResolver(reciboSchema),
    mode: "onTouched",
    defaultValues: valores,
  });
  const { register, control, handleSubmit, setError, setValue, getFieldState, watch, formState } = form;
  const errors = formState.errors;

  // Cada respuesta del servidor se procesa una sola vez, aunque el efecto se repita.
  const procesado = useRef<typeof state>(undefined);
  useEffect(() => {
    if (!state || procesado.current === state) return;
    procesado.current = state;
    if (state.fieldErrors) {
      for (const [key, message] of Object.entries(state.fieldErrors)) {
        if (message) setError(key as ReciboField, { message });
      }
    }
    if (state.error && !state.fieldErrors) toast.error(state.error);
    if (state.ok) {
      toast.success(modo.tipo === "nuevo" ? "Recibo creado" : "Recibo actualizado");
      onClose();
    }
  }, [state, setError, onClose, modo.tipo]);

  // Servicios creados desde este formulario: se muestran ya, sin esperar a que la página recargue.
  const [creados, setCreados] = useState<Servicio[]>([]);
  const [nuevoServicio, setNuevoServicio] = useState(servicios.length === 0);
  const lista = [...servicios, ...creados.filter((c) => !servicios.some((s) => s.id === c.id))];

  // En un recibo nuevo, la referencia y el corte salen del servicio mientras el usuario no los toque.
  const servicioId = watch("servicio_id");
  const mes = watch("mes");
  useEffect(() => {
    if (modo.tipo !== "nuevo") return;
    const s = [...servicios, ...creados].find((x) => x.id === servicioId);
    if (!s) return;
    if (!getFieldState("referencia").isDirty) setValue("referencia", s.referencia ?? "");
    if (!getFieldState("fecha_corte").isDirty && /^\d{4}-\d{2}$/.test(mes)) {
      setValue("fecha_corte", s.dia_corte ? corteDelMes(mes, s.dia_corte) : "");
    }
  }, [modo.tipo, servicioId, mes, servicios, creados, getFieldState, setValue]);

  const opciones = lista.filter((s) => s.activo || s.id === valores.servicio_id);

  function servicioCreado(s: Servicio) {
    setCreados((prev) => [...prev, s]);
    setValue("servicio_id", s.id, { shouldDirty: true, shouldValidate: true });
    setNuevoServicio(false);
  }

  function onValid(values: ReciboInput) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v ?? "");
    startTransition(() => formAction(fd));
  }

  const err = (k: ReciboField) => errors[k]?.message;

  return (
    <form onSubmit={handleSubmit(onValid)} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <fieldset className="space-y-3">
          <legend className="mb-0.5">
            <SectionLabel>Servicio</SectionLabel>
          </legend>
          <div className="space-y-1.5">
            <Label htmlFor="recibo-servicio">Servicio</Label>
            <Controller
              control={control}
              name="servicio_id"
              render={({ field }) => (
                <Select
                  value={field.value || undefined}
                  onValueChange={(v) => (v === NUEVO ? setNuevoServicio(true) : field.onChange(v))}
                >
                  <SelectTrigger id="recibo-servicio" aria-invalid={Boolean(err("servicio_id"))} className="w-full">
                    <SelectValue placeholder={opciones.length ? "Elige el servicio" : "Primero agrega un servicio"} />
                  </SelectTrigger>
                  <SelectContent>
                    {opciones.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.proveedor} · {s.servicio}
                        {s.referencia ? ` · ${s.referencia}` : ""}
                      </SelectItem>
                    ))}
                    <SelectItem value={NUEVO} className="font-medium text-primary">
                      <Plus className="size-3.5" />
                      Agregar servicio nuevo
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {err("servicio_id") && !nuevoServicio && (
              <FieldError id="recibo-servicio-error">{err("servicio_id")}</FieldError>
            )}
            {nuevoServicio ? (
              <ServicioRapido
                onCreado={servicioCreado}
                onCancelar={servicios.length > 0 || creados.length > 0 ? () => setNuevoServicio(false) : undefined}
              />
            ) : (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                onClick={() => setNuevoServicio(true)}
              >
                <Plus className="size-3" />
                ¿No está en la lista? Agrega un servicio nuevo
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="recibo-mes">Mes del recibo</Label>
              <Input id="recibo-mes" type="month" aria-invalid={Boolean(err("mes"))} {...register("mes")} />
              {err("mes") && <FieldError id="recibo-mes-error">{err("mes")}</FieldError>}
            </div>
            <CampoFecha form={form} name="fecha_corte" label="Fecha de corte" hoy={hoy} hint="Desde aquí se espera la factura." />
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-0.5">
            <SectionLabel>Factura</SectionLabel>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="recibo-referencia">Número de referencia</Label>
              <Input id="recibo-referencia" autoComplete="off" className="font-mono" maxLength={80} {...register("referencia")} />
              {err("referencia") && <FieldError id="recibo-referencia-error">{err("referencia")}</FieldError>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="recibo-valor">Valor (COP)</Label>
              <Input
                id="recibo-valor"
                inputMode="decimal"
                autoComplete="off"
                placeholder="Ej. 245300"
                className="font-mono tabular-nums"
                autoFocus={modo.tipo === "factura"}
                aria-invalid={Boolean(err("valor"))}
                {...register("valor")}
              />
              {err("valor") && <FieldError id="recibo-valor-error">{err("valor")}</FieldError>}
            </div>
          </div>
          <CampoFecha form={form} name="fecha_recibido" label="Llegó el" hoy={hoy} />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-0.5">
            <SectionLabel>Seguimiento</SectionLabel>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <CampoFecha form={form} name="fecha_registro" label="Registrado y enviado a Tesorería" hoy={hoy} />
            <CampoFecha form={form} name="fecha_pago" label="Pagado el" hoy={hoy} hint="Cuando Tesorería confirme el pago." />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="recibo-observaciones">
              Observaciones <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <Textarea id="recibo-observaciones" rows={2} maxLength={1000} {...register("observaciones")} />
            {err("observaciones") && <FieldError id="recibo-observaciones-error">{err("observaciones")}</FieldError>}
          </div>
        </fieldset>
      </div>

      <PieVentana>
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {pending ? "Guardando…" : "Guardar"}
        </Button>
      </PieVentana>
    </form>
  );
}

const NUEVO = "__nuevo__";

/**
 * Alta rápida de un servicio sin salir del recibo. No es un <form> (estaría anidado en el del
 * recibo): valida con el mismo esquema que el catálogo y llama a la misma server action.
 */
function ServicioRapido({ onCreado, onCancelar }: { onCreado: (s: Servicio) => void; onCancelar?: () => void }) {
  const [valores, setValores] = useState({ proveedor: "", servicio: "", referencia: "", dia_corte: "", notas: "" });
  const [errores, setErrores] = useState<Partial<Record<string, string>>>({});
  const [pending, startCrear] = useTransition();

  const campo = (k: keyof typeof valores) => ({
    value: valores[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValores((v) => ({ ...v, [k]: e.target.value })),
    // Enter crea el servicio en vez de enviar el formulario del recibo.
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        crear();
      }
    },
    "aria-invalid": Boolean(errores[k]),
  });

  function crear() {
    const parsed = servicioSchema.safeParse({ id: "", ...valores });
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) e[String(issue.path[0])] ??= issue.message;
      setErrores(e);
      return;
    }
    setErrores({});
    startCrear(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(parsed.data)) fd.set(k, v ?? "");
      const res = await guardarServicio(undefined, fd);
      if (res.fieldErrors) setErrores(res.fieldErrors);
      if (!res.ok || !res.id) {
        if (!res.fieldErrors) toast.error(res.error ?? "No se pudo crear el servicio.");
        return;
      }
      toast.success("Servicio agregado");
      onCreado({
        id: res.id,
        proveedor: parsed.data.proveedor,
        servicio: parsed.data.servicio,
        referencia: parsed.data.referencia || null,
        dia_corte: parsed.data.dia_corte ? Number(parsed.data.dia_corte) : null,
        activo: true,
        notas: null,
      });
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-primary/25 bg-primary/[0.03] p-3">
      <p className="text-sm font-semibold">Nuevo servicio</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="rapido-proveedor">Proveedor</Label>
          <Input id="rapido-proveedor" placeholder="Ej. Enel" autoComplete="off" autoFocus {...campo("proveedor")} />
          {errores.proveedor && <FieldError id="rapido-proveedor-error">{errores.proveedor}</FieldError>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rapido-servicio">Servicio</Label>
          <Input id="rapido-servicio" list="rapido-tipos" placeholder="Ej. Energía" autoComplete="off" {...campo("servicio")} />
          <datalist id="rapido-tipos">
            {TIPOS_SERVICIO.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          {errores.servicio && <FieldError id="rapido-servicio-error">{errores.servicio}</FieldError>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rapido-referencia">
            Referencia / cuenta <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input id="rapido-referencia" className="font-mono" autoComplete="off" {...campo("referencia")} />
          {errores.referencia && <FieldError id="rapido-referencia-error">{errores.referencia}</FieldError>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rapido-corte">
            Día de corte <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Input id="rapido-corte" inputMode="numeric" placeholder="1 a 31" className="font-mono tabular-nums" {...campo("dia_corte")} />
          {errores.dia_corte && <FieldError id="rapido-corte-error">{errores.dia_corte}</FieldError>}
        </div>
      </div>
      <div className="flex justify-end gap-2">
        {onCancelar && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancelar} disabled={pending}>
            Cancelar
          </Button>
        )}
        <Button type="button" size="sm" onClick={crear} disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Crear servicio
        </Button>
      </div>
    </div>
  );
}

function CampoFecha({
  form,
  name,
  label,
  hoy,
  hint,
}: {
  form: UseFormReturn<ReciboInput>;
  name: "fecha_corte" | "fecha_recibido" | "fecha_registro" | "fecha_pago";
  label: string;
  hoy: string;
  hint?: string;
}) {
  const id = `recibo-${name}`;
  const error = form.formState.errors[name]?.message;
  const valor = form.watch(name);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {valor ? (
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => form.setValue(name, "", { shouldDirty: true, shouldValidate: true })}
          >
            Quitar
          </button>
        ) : (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => form.setValue(name, hoy, { shouldDirty: true, shouldValidate: true })}
          >
            Hoy
          </button>
        )}
      </div>
      <Input id={id} type="date" className="font-mono tabular-nums" aria-invalid={Boolean(error)} {...form.register(name)} />
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

"use client";

import { startTransition, useActionState, useEffect, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AlertaIndicador, SectionLabel, TONO_ALERTA } from "@/components/servicios-publicos/bits";
import {
  createAnticipo,
  deleteAnticipo,
  updateAnticipo,
  type CreateAnticipoState,
  type UpdateAnticipoState,
} from "@/lib/anticipos/actions";
import {
  formatAnticipoCedula,
  formatAnticipoCurrency,
  formatAnticipoFecha,
} from "@/lib/anticipos/format";
import {
  anticipoCreateSchema,
  anticipoUpdateSchema,
  todayIsoDate,
  type AnticipoCreateInput,
  type AnticipoRow,
  type AnticipoUpdateInput,
} from "@/lib/anticipos/schema";
import { fechaMaximaLegalizacion, NIVEL_SEGUIMIENTO_LABEL, seguimientoDe } from "@/lib/anticipos/seguimiento";
import { cn } from "@/lib/utils";

import { AnticiposFormFields, ANTICIPOS_DEFAULT_VALUES } from "./anticipos-form";
import { ExcolaboradorChip, FaltaBadge, ObservacionBadge } from "./badges";
import { LegalizarBoton } from "./legalizar-boton";

/** Lo que muestra la sheet. `detalle` y `editar` se alternan sin cerrarla. */
export type ModoSheet =
  | { tipo: "nuevo" }
  | { tipo: "detalle"; row: AnticipoRow }
  | { tipo: "editar"; row: AnticipoRow };

const MATCH_LABELS: Record<NonNullable<AnticipoRow["retiro_info"]>["nivel"], string> = {
  exacto: "Exacta",
  exacto_inverso: "Exacta (orden invertido)",
  parcial: "Parcial",
};

export function AnticipoSheet({
  modo,
  hoy,
  soloLectura,
  onModo,
  onClose,
}: {
  /** `null` = cerrada. */
  modo: ModoSheet | null;
  hoy: string;
  soloLectura: boolean;
  onModo: (modo: ModoSheet) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={modo !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {modo?.tipo === "detalle" && (
          <Detalle
            key={modo.row.id}
            row={modo.row}
            hoy={hoy}
            soloLectura={soloLectura}
            onEditar={() => onModo({ tipo: "editar", row: modo.row })}
            onClose={onClose}
          />
        )}
        {modo?.tipo === "editar" && (
          <Editar
            key={`editar-${modo.row.id}`}
            row={modo.row}
            onVolver={() => onModo({ tipo: "detalle", row: modo.row })}
          />
        )}
        {modo?.tipo === "nuevo" && <Nuevo onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function Detalle({
  row,
  hoy,
  soloLectura,
  onEditar,
  onClose,
}: {
  row: AnticipoRow;
  hoy: string;
  soloLectura: boolean;
  onEditar: () => void;
  onClose: () => void;
}) {
  const seguimiento = seguimientoDe(row, hoy);
  const retiro = row.retiro_info;
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [borrando, startBorrado] = useTransition();

  function eliminar() {
    startBorrado(async () => {
      const res = await deleteAnticipo(row.id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Registro eliminado");
      setConfirmarBorrado(false);
      onClose();
    });
  }

  return (
    <>
      <SheetHeader className="border-b border-border pr-12">
        <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
          {row.nombre}
          {row.es_retirado && <ExcolaboradorChip parcial={retiro?.nivel === "parcial"} />}
        </SheetTitle>
        <SheetDescription>
          Requerimiento <span className="font-mono">{row.requerimiento}</span>
        </SheetDescription>
        <div className={cn("mt-2 rounded-md border px-3 py-2", TONO_ALERTA[seguimiento.nivel].chip)}>
          <AlertaIndicador alerta={seguimiento} etiquetas={NIVEL_SEGUIMIENTO_LABEL} />
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <section className="space-y-2">
          <SectionLabel>Datos</SectionLabel>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Valor</dt>
            <dd className="font-mono tabular-nums">{formatAnticipoCurrency(row.valor) ?? "—"}</dd>
            <dt className="text-muted-foreground">Falta</dt>
            <dd className="min-w-0">
              <FaltaBadge value={row.falta} />
            </dd>
            <dt className="text-muted-foreground">Observación 1</dt>
            <dd className="min-w-0">
              <ObservacionBadge value={row.observacion_1} />
            </dd>
            <dt className="text-muted-foreground">Fecha final</dt>
            <dd className="font-mono tabular-nums">{formatAnticipoFecha(row.fecha_rq)}</dd>
            <dt className="text-muted-foreground">Fecha máxima de legalización</dt>
            <dd className="font-mono tabular-nums">{formatAnticipoFecha(fechaMaximaLegalizacion(row.fecha_rq))}</dd>
            <dt className="text-muted-foreground">Fecha de gestión</dt>
            <dd className="font-mono tabular-nums">{formatAnticipoFecha(row.fecha_gestion)}</dd>
          </dl>
        </section>

        <section className="space-y-2">
          <SectionLabel>Observación 2</SectionLabel>
          {row.observacion_2 ? (
            <p className="whitespace-pre-wrap break-words text-sm">{row.observacion_2}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Sin notas.</p>
          )}
        </section>

        {retiro && (
          <section className="space-y-2">
            <SectionLabel>Reporte de Contabilidad</SectionLabel>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-border px-3 py-2.5 text-sm">
              <dt className="text-muted-foreground">Nombre</dt>
              <dd>{retiro.nombre}</dd>
              <dt className="text-muted-foreground">Cédula</dt>
              <dd className="font-mono tabular-nums">{formatAnticipoCedula(retiro.cedula)}</dd>
              <dt className="text-muted-foreground">Valor reportado</dt>
              <dd className="font-mono tabular-nums">{formatAnticipoCurrency(retiro.valor) ?? "—"}</dd>
              <dt className="text-muted-foreground">Reportado</dt>
              <dd className="font-mono tabular-nums">{formatAnticipoFecha(retiro.fecha_reporte)}</dd>
              <dt className="text-muted-foreground">Coincidencia</dt>
              <dd>
                {MATCH_LABELS[retiro.nivel]}
                {retiro.tokensExtra.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    Difiere en: {retiro.tokensExtra.join(" ")}
                  </span>
                )}
              </dd>
              {retiro.observacion && (
                <>
                  <dt className="text-muted-foreground">Observación</dt>
                  <dd className="whitespace-pre-wrap">{retiro.observacion}</dd>
                </>
              )}
            </dl>
          </section>
        )}
      </div>

      {!soloLectura && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-5 py-3">
          <LegalizarBoton row={row} />
          <Button type="button" variant="outline" size="sm" onClick={onEditar}>
            <Pencil className="size-3.5" />
            Editar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() => setConfirmarBorrado(true)}
          >
            <Trash2 className="size-3.5" />
            Eliminar
          </Button>
        </div>
      )}

      <AlertDialog open={confirmarBorrado} onOpenChange={setConfirmarBorrado}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este registro?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a eliminar el anticipo de {row.nombre} · {row.requerimiento}. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost" disabled={borrando}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={borrando}
              onClick={(e) => {
                e.preventDefault();
                eliminar();
              }}
            >
              {borrando && <Loader2 className="size-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function toFormData(values: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    fd.set(key, String(value));
  }
  return fd;
}

function Editar({ row, onVolver }: { row: AnticipoRow; onVolver: () => void }) {
  const [state, formAction] = useActionState<UpdateAnticipoState | undefined, FormData>(updateAnticipo, undefined);
  const form = useForm<AnticipoUpdateInput>({
    resolver: zodResolver(anticipoUpdateSchema),
    mode: "onTouched",
    defaultValues: {
      id: row.id,
      nombre: row.nombre,
      requerimiento: row.requerimiento,
      falta: row.falta,
      observacion_1: row.observacion_1,
      observacion_2: row.observacion_2 ?? "",
      valor: row.valor == null ? "" : String(row.valor),
      fecha_rq: row.fecha_rq,
      fecha_gestion: row.fecha_gestion ?? "",
    },
  });
  const { setError } = form;

  useEffect(() => {
    if (!state) return;
    for (const [key, message] of Object.entries(state.fieldErrors ?? {})) {
      if (message) setError(key as keyof AnticipoUpdateInput, { message });
    }
    if (state.error && !state.fieldErrors) toast.error(state.error);
    if (state.ok) {
      toast.success("Registro actualizado");
      onVolver();
    }
  }, [state, setError, onVolver]);

  return (
    <>
      <SheetHeader className="border-b border-border pr-12">
        <SheetTitle className="text-base">Editar registro</SheetTitle>
        <SheetDescription>
          <span className="font-medium text-foreground">{row.nombre}.</span> Los cambios se guardan al confirmar.
        </SheetDescription>
      </SheetHeader>
      <AnticiposFormFields<AnticipoUpdateInput>
        form={form}
        formId="anticipo-editar-form"
        submitLabel="Guardar cambios"
        onCancel={onVolver}
        onSubmit={(values) => startTransition(() => formAction(toFormData(values)))}
      />
    </>
  );
}

function Nuevo({ onClose }: { onClose: () => void }) {
  const [state, formAction] = useActionState<CreateAnticipoState | undefined, FormData>(createAnticipo, undefined);
  const form = useForm<AnticipoCreateInput>({
    resolver: zodResolver(anticipoCreateSchema),
    mode: "onTouched",
    defaultValues: { ...ANTICIPOS_DEFAULT_VALUES, fecha_rq: todayIsoDate() },
  });
  const { setError } = form;

  useEffect(() => {
    if (!state) return;
    for (const [key, message] of Object.entries(state.fieldErrors ?? {})) {
      if (message) setError(key as keyof AnticipoCreateInput, { message });
    }
    if (state.error && !state.fieldErrors) toast.error(state.error);
    if (state.ok) {
      toast.success("Registro creado");
      onClose();
    }
  }, [state, setError, onClose]);

  return (
    <>
      <SheetHeader className="border-b border-border pr-12">
        <SheetTitle className="text-base">Nuevo registro</SheetTitle>
        <SheetDescription>
          Captura la información del anticipo. La fecha de gestión puede quedar en blanco y asignarse al legalizarlo.
        </SheetDescription>
      </SheetHeader>
      <AnticiposFormFields<AnticipoCreateInput>
        form={form}
        formId="anticipo-nuevo-form"
        onCancel={onClose}
        onSubmit={(values) => startTransition(() => formAction(toFormData(values)))}
      />
    </>
  );
}

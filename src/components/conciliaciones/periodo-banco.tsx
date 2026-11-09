"use client";

import * as React from "react";
import { CalendarRange, Pencil, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { guardarPeriodoBanco } from "@/lib/conciliaciones/actions";
import {
  fechaLarga,
  hoyEnPais,
  nombreMes,
  periodoVigente,
  ultimoDiaDelMes,
  validarPeriodo,
} from "@/lib/conciliaciones/periodo";

import { cn } from "@/lib/utils";

import type { BancoConciliacion, Pais } from "./types";

interface PeriodoBancoProps {
  pais: Pais;
  banco: BancoConciliacion;
  editable: boolean;
  disabled?: boolean;
  onSaved: (periodo: string, periodoCierre: string) => void;
}

/** `2026-11-03` → `03/11` (fecha corta, para cifras en mono). */
function diaMes(fecha: string): string {
  const [, m, d] = fecha.split("-");
  return `${d}/${m}`;
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000);
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function Dato({
  etiqueta,
  children,
  className,
}: {
  etiqueta: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <dt className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {etiqueta}
      </dt>
      <dd className="flex h-9 items-center gap-1.5 whitespace-nowrap text-sm text-foreground">
        {children}
      </dd>
    </div>
  );
}

/** Periodo vigente del banco (mes, registros que cuentan y cierre) + edición. */
export function PeriodoBanco({ pais, banco, editable, disabled, onSaved }: PeriodoBancoProps) {
  const hoy = hoyEnPais(pais);
  const vigente = periodoVigente({ periodo: banco.periodo, cierre: banco.periodoCierre }, hoy);
  const mesLabel = capitalizar(nombreMes(vigente.mes));
  const diasCierre = vigente.cierre ? diasEntre(hoy, vigente.cierre) : null;

  const [open, setOpen] = React.useState(false);
  const [mes, setMes] = React.useState(vigente.mes);
  const [cierre, setCierre] = React.useState(vigente.cierre ?? ultimoDiaDelMes(vigente.mes));
  const [pending, startTransition] = React.useTransition();
  const error = validarPeriodo(mes, cierre);

  function abrir(next: boolean) {
    if (next) {
      setMes(vigente.mes);
      setCierre(vigente.cierre ?? ultimoDiaDelMes(vigente.mes));
    }
    setOpen(next);
  }

  function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (error) return;
    startTransition(async () => {
      const res = await guardarPeriodoBanco({ pais, banco: banco.slug, mes, cierre });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onSaved(`${mes}-01`, cierre);
      setOpen(false);
      toast.success(
        cierre < hoy
          ? `Periodo guardado. El cierre ya pasó: se concilia el mes en curso.`
          : `${banco.nombre}: conciliando ${nombreMes(mes)} hasta el ${fechaLarga(cierre)}`,
      );
    });
  }

  return (
    <div
      data-tour="periodo"
      className="flex min-w-0 flex-1 flex-wrap items-end justify-between gap-x-6 gap-y-4"
    >
      <dl
        aria-label={`Periodo de conciliación de ${banco.nombre}`}
        className="flex flex-wrap items-end gap-x-6 gap-y-4"
      >
        <Dato etiqueta="Conciliando">
          <CalendarRange className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-semibold">{mesLabel}</span>
        </Dato>
        <Dato etiqueta="Registros del">
          <span className="font-mono font-medium tabular-nums">
            {diaMes(vigente.desde)} – {diaMes(vigente.hasta)}
          </span>
        </Dato>
        <Dato etiqueta="Cierre">
          {vigente.cierre ? (
            <>
              <span className="font-mono font-medium tabular-nums">{diaMes(vigente.cierre)}</span>
              <span className="text-xs text-muted-foreground">
                {diasCierre === 0
                  ? "· hoy es el último día"
                  : `· ${diasCierre === 1 ? "falta 1 día" : `faltan ${diasCierre} días`}`}
              </span>
            </>
          ) : (
            <>
              <span
                title="Sin fecha de cierre: se concilia el mes en curso"
                className="inline-flex items-center gap-1 rounded-md border border-amber-200/70 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300"
              >
                <TriangleAlert className="size-3" aria-hidden />
                Sin definir
              </span>
              <span className="text-xs text-muted-foreground">· mes en curso</span>
            </>
          )}
        </Dato>
      </dl>
      {editable && (
        <Popover open={open} onOpenChange={abrir}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={disabled}>
              <Pencil className="size-3.5" aria-hidden />
              Cambiar periodo
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80">
            <form onSubmit={guardar} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">Periodo de {banco.nombre}</p>
                <p className="text-xs text-muted-foreground">
                  Aplica a todos los que concilian este banco. Pasada la fecha de cierre se concilia
                  el mes en curso.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="periodo-mes">Mes que se concilia</Label>
                <Input
                  id="periodo-mes"
                  type="month"
                  value={mes}
                  onChange={(e) => {
                    setMes(e.target.value);
                    if (
                      /^\d{4}-\d{2}$/.test(e.target.value) &&
                      cierre < ultimoDiaDelMes(e.target.value)
                    ) {
                      setCierre(ultimoDiaDelMes(e.target.value));
                    }
                  }}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="periodo-cierre">Se sigue conciliando hasta el</Label>
                <Input
                  id="periodo-cierre"
                  type="date"
                  value={cierre}
                  min={/^\d{4}-\d{2}$/.test(mes) ? ultimoDiaDelMes(mes) : undefined}
                  onChange={(e) => setCierre(e.target.value)}
                  required
                />
              </div>
              {error && mes && cierre ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : (
                !error && (
                  <p className="rounded-md bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
                    Se tendrán en cuenta los registros del{" "}
                    <span className="font-medium text-foreground">
                      {fechaLarga(`${mes}-01`)} al {fechaLarga(ultimoDiaDelMes(mes))}
                    </span>{" "}
                    hasta el{" "}
                    <span className="font-medium text-foreground">{fechaLarga(cierre)}</span>.
                  </p>
                )
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={pending || !!error}>
                  {pending ? "Guardando…" : "Guardar"}
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, Download, Loader2, Save, XCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { periodoLabel, type CierreCalculo, type CohorteCalculo } from "@/lib/comisiones/calculo";
import type { Control } from "@/lib/comisiones/types";
import { cn } from "@/lib/utils";

import { formatCentavos, formatFraction, formatShortDateTime } from "./format";
import { Termino } from "./glosario";
import type { DestinoTarea, Tarea } from "./tareas";

interface ResultadoCardProps {
  cierre: CierreCalculo;
  controles: Control[];
  tareas: Tarea[];
  /** "informe": del archivo cargado; "registrado": cierre guardado o histórico. */
  fuente: "informe" | "registrado";
  guardadoEn: string | null;
  sinGuardar: boolean;
  /** Se puede guardar: hay informe cargado y el usuario tiene nivel `usar`. */
  puedeGuardar: boolean;
  guardando: boolean;
  exportando: boolean;
  onGuardar: () => void;
  onExportar: () => void;
  onTarea: (destino: DestinoTarea) => void;
}

/** El resultado del mes en palabras, lo que hay que revisar y cómo terminar. */
export function ResultadoCard({
  cierre,
  controles,
  tareas,
  fuente,
  guardadoEn,
  sinGuardar,
  puedeGuardar,
  guardando,
  exportando,
  onGuardar,
  onExportar,
  onTarea,
}: ResultadoCardProps) {
  const mes = periodoLabel(cierre.periodo).toLowerCase();
  const propia = cierre.cohortes.find((k) => k.esPropia) ?? null;
  const anteriores = cierre.cohortes.filter((k) => !k.esPropia);
  const delMes = propia?.gastoMes ?? 0;
  const deAnteriores = anteriores.reduce((a, k) => a + k.gastoMes, 0);
  const conGasto = cierre.cohortes.filter((k) => k.gastoMes + k.ajusteCierre !== 0).length;

  const errores = tareas.filter((t) => t.estado === "error").length;
  const correctos = controles.filter((c) => c.estado === "ok").length;
  const guardado = !!guardadoEn && !sinGuardar;

  return (
    <section
      aria-labelledby="resultado-titulo"
      data-tour="resultado"
      className="grid overflow-hidden rounded-lg border border-border bg-card shadow-sm lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"
    >
      <div className="flex min-w-0 flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h3 id="resultado-titulo" className="text-sm text-muted-foreground">
            Este mes llevas al gasto de comisiones
          </h3>
          <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
            {formatCentavos(cierre.gastoMes)}
          </span>
          <p className="max-w-prose text-pretty text-sm text-muted-foreground">
            Sale de {conGasto === 1 ? "1 mes" : `${conGasto} meses`} de comisiones que se siguen
            reconociendo. Quedan{" "}
            <span className="font-mono tabular-nums text-foreground">
              {formatCentavos(cierre.saldoDiferido)}
            </span>{" "}
            <Termino t="diferido">diferidos</Termino> para meses futuros.
          </p>
        </div>

        <dl className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
          <Cifra label={`De las comisiones de ${mes}`} valor={delMes} />
          <Cifra label="De comisiones de meses anteriores" valor={deAnteriores} />
          <Cifra
            label={<Termino t="ajuste">Ajustes de cierre</Termino>}
            valor={cierre.ajustesCierre}
          />
        </dl>

        <PorQue cierre={cierre} propia={propia} anteriores={anteriores} />

        {fuente === "registrado" && (
          <p className="text-xs text-muted-foreground">
            Calculado con el ingreso ya registrado para {mes}. Carga el informe para recalcularlo.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3 border-t border-border bg-muted/30 p-5 sm:p-6 lg:border-l lg:border-t-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {tareas.length === 0
              ? "Todo cuadra"
              : errores > 0
                ? `Resuelve ${errores === 1 ? "1 punto" : `${errores} puntos`} antes de guardar`
                : `${tareas.length === 1 ? "1 punto" : `${tareas.length} puntos`} para revisar`}
          </h3>
          <EstadoGuardado guardadoEn={guardadoEn} sinGuardar={sinGuardar} fuente={fuente} />
        </div>

        {tareas.length > 0 && (
          <ul className="flex flex-col gap-2" data-tour="tareas">
            {tareas.map((t) => (
              <TareaItem key={t.id} tarea={t} onClick={() => onTarea(t.destino)} />
            ))}
          </ul>
        )}

        {correctos > 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 aria-hidden className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            {correctos === 1 ? "1 control correcto" : `${correctos} controles correctos`}
            {tareas.length === 0 && ": los asientos cuadran"}
          </p>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onExportar} disabled={exportando}>
              {exportando ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Exportar Excel
            </Button>
            {puedeGuardar && (
              <Button onClick={onGuardar} disabled={guardando || errores > 0 || guardado}>
                {guardando ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {guardado ? "Cierre guardado" : "Guardar cierre"}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {errores > 0
              ? "Guardar se habilita cuando no quede ningún punto en rojo."
              : guardado
                ? `Exporta el Excel para registrar los ${cierre.asientos.length} asientos en NetSuite.`
                : puedeGuardar
                  ? "Guarda el cierre y luego exporta el Excel con los asientos para NetSuite."
                  : `El Excel trae los ${cierre.asientos.length} asientos para NetSuite.`}
          </p>
        </div>
      </div>
    </section>
  );
}

function Cifra({ label, valor }: { label: React.ReactNode; valor: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums">{formatCentavos(valor)}</dd>
    </div>
  );
}

/** La cuenta explicada con una cohorte real del mes. */
function PorQue({
  cierre,
  propia,
  anteriores,
}: {
  cierre: CierreCalculo;
  propia: CohorteCalculo | null;
  anteriores: CohorteCalculo[];
}) {
  const [abierto, setAbierto] = useState(false);
  // El ejemplo: la cohorte anterior con más gasto calculado por fórmula.
  const ejemplo =
    [...anteriores]
      .filter((k) => k.gastoMes !== 0 && !k.alertas.includes("registrado") && !k.alertas.includes("tope"))
      .sort((a, b) => Math.abs(b.gastoMes) - Math.abs(a.gastoMes))[0] ?? null;
  const cerradas = cierre.cohortes.filter((k) => k.ajusteCierre !== 0);
  const topadas = cierre.cohortes.filter((k) => k.alertas.includes("tope") && k.gastoMes !== 0);
  const registradas = cierre.cohortes.filter((k) => k.alertas.includes("registrado"));
  const mes = periodoLabel(cierre.periodo).toLowerCase();

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls="por-que"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium text-primary hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ¿Por qué este número?
        <ChevronDown aria-hidden className={cn("size-4 transition-transform", abierto && "rotate-180")} />
      </button>
      {abierto && (
        <div id="por-que" className="flex flex-col gap-3 border-t border-border px-3 pb-3 pt-3 text-sm">
          <p className="text-pretty text-muted-foreground">
            Las comisiones de cada mes (cada <Termino t="cohorte">cohorte</Termino>) se llevan al gasto
            en el mismo porcentaje en que se reconoce el ingreso de sus facturas{" "}
            <Termino t="f93f94">F93/F94</Termino>.
          </p>

          {ejemplo && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">
                Ejemplo con las comisiones de {periodoLabel(ejemplo.cohorte).toLowerCase()}
              </span>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md bg-muted/60 px-3 py-2.5 font-mono tabular-nums">
                <span>{formatCentavos(ejemplo.comisiones)}</span>
                <span className="font-sans text-xs text-muted-foreground">comisiones</span>
                <span aria-label="por">×</span>
                <span>{formatFraction(ejemplo.pctMes, 2)}</span>
                <span className="font-sans text-xs text-muted-foreground">del ingreso reconocido en {mes}</span>
                <span aria-label="igual a">=</span>
                <span className="font-semibold">{formatCentavos(ejemplo.gastoMes)}</span>
              </div>
            </div>
          )}

          {propia && propia.comisiones !== 0 && (
            <p className="text-pretty text-muted-foreground">
              De las comisiones causadas en {mes} ({formatCentavos(propia.comisiones)}), van al gasto{" "}
              <span className="font-mono tabular-nums text-foreground">{formatCentavos(propia.gastoMes)}</span>{" "}
              y quedan diferidos{" "}
              <span className="font-mono tabular-nums text-foreground">{formatCentavos(cierre.diferidoNuevo)}</span>.
            </p>
          )}

          {(topadas.length > 0 || cerradas.length > 0 || registradas.length > 0) && (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
              {topadas.length > 0 && (
                <li>
                  {listaMeses(topadas)}: llegaron al 100 %, así que solo se lleva lo que faltaba (
                  <Termino t="tope">tope</Termino>).
                </li>
              )}
              {cerradas.length > 0 && (
                <li>
                  {listaMeses(cerradas)}: sus facturas ya no tienen ingreso por reconocer y el saldo se lleva
                  como ajuste de cierre.
                </li>
              )}
              {registradas.length > 0 && (
                <li>{listaMeses(registradas)}: usa el gasto contabilizado a mano en lugar de la fórmula.</li>
              )}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            El detalle de cada mes está en &quot;Ver detalle&quot;, debajo de esta tarjeta.
          </p>
        </div>
      )}
    </div>
  );
}

const listaMeses = (ks: CohorteCalculo[]) => {
  const xs = ks.map((k) => periodoLabel(k.cohorte));
  return xs.length <= 3 ? xs.join(", ") : `${xs.slice(0, 3).join(", ")} y ${xs.length - 3} más`;
};

function TareaItem({ tarea, onClick }: { tarea: Tarea; onClick: () => void }) {
  const error = tarea.estado === "error";
  const Icon = error ? XCircle : AlertTriangle;
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-md border bg-card px-3 py-2.5",
        error ? "border-destructive/40" : "border-border",
      )}
    >
      <Icon
        role="img"
        aria-label={error ? "Impide guardar" : "Para revisar"}
        className={cn(
          "mt-0.5 size-4 shrink-0",
          error ? "text-destructive" : "text-amber-600 dark:text-amber-400",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{tarea.titulo}</span>
        <span className="text-pretty text-xs text-muted-foreground">{tarea.detalle}</span>
      </div>
      <Button size="sm" variant={error ? "default" : "outline"} className="h-7 shrink-0 px-2.5 text-xs" onClick={onClick}>
        {tarea.boton}
      </Button>
    </li>
  );
}

function EstadoGuardado({
  guardadoEn,
  sinGuardar,
  fuente,
}: {
  guardadoEn: string | null;
  sinGuardar: boolean;
  fuente: "informe" | "registrado";
}) {
  const texto =
    fuente === "registrado"
      ? guardadoEn
        ? `Guardado ${formatShortDateTime(guardadoEn)}`
        : "Registrado desde el Excel"
      : !guardadoEn
        ? "Sin guardar"
        : sinGuardar
          ? "Cambios sin guardar"
          : `Guardado ${formatShortDateTime(guardadoEn)}`;
  const pendiente = fuente === "informe" && (!guardadoEn || sinGuardar);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        pendiente
          ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", pendiente ? "bg-amber-500" : "bg-emerald-500")} />
      {texto}
    </span>
  );
}

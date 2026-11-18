"use client";

import { Fragment, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Copy,
  CheckCircle2,
  ChevronRight,
  Info,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  periodoCorto,
  periodoLabel,
  totalesAsiento,
  type AlertaCohorte,
  type CierreCalculo,
  type CohorteCalculo,
} from "@/lib/comisiones/calculo";
import type { Asiento, Control, EstadoControl } from "@/lib/comisiones/types";
import { cn } from "@/lib/utils";

import { formatCentavos, formatFraction, formatImporte } from "./format";
import { TONO_GRUPO, type TonoGrupo } from "./grupo";

interface RevisionPanelProps {
  cierre: CierreCalculo;
  controles: Control[];
  /** Pestaña abierta; la controla la página para que las tareas lleven a ella. */
  vista: VistaDetalle;
  onVista: (vista: VistaDetalle) => void;
  /** Detalle por comprobante; solo existe con el informe cargado. */
  comprobantes?: React.ReactNode;
}

export type VistaDetalle = "cohortes" | "asientos" | "controles" | "comprobantes";

/** Detalle del cierre: cálculo por cohorte, asientos, controles y comprobantes. */
export function RevisionPanel({
  cierre,
  controles,
  vista,
  onVista,
  comprobantes,
}: RevisionPanelProps) {
  const setVista = onVista;
  const anios = [...new Set(cierre.cohortes.map((c) => anioDe(c.cohorte)))].sort();
  // Por defecto, el año del cierre; la elección se olvida al cambiar de mes.
  const [eleccion, setEleccion] = useState<{ periodo: string; anio: string } | null>(null);
  const anio =
    eleccion?.periodo === cierre.periodo && anios.includes(eleccion.anio)
      ? eleccion.anio
      : anioDe(cierre.periodo);
  const onAnio = (a: string) => setEleccion({ periodo: cierre.periodo, anio: a });
  const errores = controles.filter((c) => c.estado === "error");
  const avisos = controles.filter((c) => c.estado === "warning");

  return (
    <div className="flex flex-col gap-5">
      <Tabs value={vista} onValueChange={(v) => setVista(v as VistaDetalle)} className="gap-4">
        <TabsList className="max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="cohortes">Cálculo por cohorte</TabsTrigger>
          <TabsTrigger value="asientos">
            Asientos <Contador n={cierre.asientos.length} />
          </TabsTrigger>
          <TabsTrigger value="controles">
            Controles <Contador n={errores.length + avisos.length} alerta={errores.length > 0} />
          </TabsTrigger>
          {comprobantes && <TabsTrigger value="comprobantes">Comprobantes</TabsTrigger>}
        </TabsList>
        <TabsContent value="cohortes">
          <PorAnio
            anios={anios}
            anio={anio}
            onAnio={onAnio}
            contar={(a) => cierre.cohortes.filter((c) => anioDe(c.cohorte) === a).length}
          >
            {(a) => <CohortesTable cierre={cierre} anio={anios.length > 1 ? a : null} />}
          </PorAnio>
        </TabsContent>
        <TabsContent value="asientos">
          <PorAnio
            anios={anios}
            anio={anio}
            onAnio={onAnio}
            contar={(a) => cierre.asientos.filter((x) => anioDe(x.cohorte) === a).length}
          >
            {(a) => (
              <AsientosLista
                asientos={
                  anios.length > 1
                    ? cierre.asientos.filter((x) => anioDe(x.cohorte) === a)
                    : cierre.asientos
                }
                anio={anios.length > 1 ? a : null}
              />
            )}
          </PorAnio>
        </TabsContent>
        <TabsContent value="controles">
          <ControlesList controles={controles} />
        </TabsContent>
        {comprobantes && <TabsContent value="comprobantes">{comprobantes}</TabsContent>}
      </Tabs>
    </div>
  );
}

function Contador({ n, alerta }: { n: number; alerta?: boolean }) {
  if (n === 0) return null;
  return (
    <span
      className={cn(
        "ml-1.5 rounded-md px-1.5 font-mono text-[11px] tabular-nums",
        alerta ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
      )}
    >
      {n}
    </span>
  );
}

const anioDe = (periodo: string) => periodo.slice(0, 4);

/** Sub-tabs por año de la cohorte; con un solo año muestra el contenido directo. */
function PorAnio({
  anios,
  anio,
  onAnio,
  contar,
  children,
}: {
  anios: string[];
  anio: string;
  onAnio: (anio: string) => void;
  contar: (anio: string) => number;
  children: (anio: string) => React.ReactNode;
}) {
  if (anios.length <= 1) return <>{children(anio)}</>;
  return (
    <Tabs value={anio} onValueChange={onAnio} className="gap-3">
      <TabsList variant="line" aria-label="Año de la cohorte">
        {anios.map((a) => (
          <TabsTrigger key={a} value={a} className="flex-none px-3">
            Cohortes {a} <Contador n={contar(a)} />
          </TabsTrigger>
        ))}
      </TabsList>
      {anios.map((a) => (
        <TabsContent key={a} value={a}>
          {children(a)}
        </TabsContent>
      ))}
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// Cohortes

const ALERTA: Record<AlertaCohorte, string> = {
  "sin-base": "Falta la facturación de la cohorte: no se puede calcular el %.",
  "sin-comisiones": "Faltan las comisiones causadas de la cohorte.",
  "sin-ingreso": "No reconoce ingreso este mes y aún tiene comisión diferida.",
  tope: "Llegó al 100 %: el gasto se limitó al saldo pendiente.",
  cierre:
    "Sus facturas ya no tienen ingreso por diferir: el saldo diferido se lleva al gasto como ajuste de cierre.",
  registrado: "Incluye gasto contabilizado a mano que reemplaza la fórmula.",
  "ingreso-negativo": "Ingreso negativo: las notas crédito superan el ingreso.",
  "difiere-registro": "El informe trae un ingreso distinto al registrado.",
};

interface Totales {
  ingreso: number;
  porDiferir: number | null;
  comisiones: number;
  gasto: number;
  acumulado: number;
  pendiente: number;
}

function totales(cohortes: CohorteCalculo[]): Totales {
  return cohortes.reduce<Totales>(
    (a, c) => ({
      ingreso: a.ingreso + c.ingresoMes,
      porDiferir:
        a.porDiferir === null || c.pendienteIngreso === null
          ? null
          : a.porDiferir + c.pendienteIngreso,
      comisiones: a.comisiones + c.comisiones,
      gasto: a.gasto + c.gastoMes + c.ajusteCierre,
      acumulado: a.acumulado + c.acumulado,
      pendiente: a.pendiente + c.pendiente,
    }),
    { ingreso: 0, porDiferir: 0, comisiones: 0, gasto: 0, acumulado: 0, pendiente: 0 },
  );
}

/** `anio`: solo las cohortes de ese año, con su subtotal y el total del mes. */
function CohortesTable({ cierre, anio }: { cierre: CierreCalculo; anio: string | null }) {
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const toggle = (c: string) =>
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  // Sin informe cargado no se conoce lo que queda por diferir: no se muestra.
  const conPorDiferir = cierre.cohortes.some((c) => c.pendienteIngreso !== null);
  const cohortes = anio ? cierre.cohortes.filter((c) => anioDe(c.cohorte) === anio) : cierre.cohortes;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Valores en pesos. El % del mes es el ingreso de las facturas de la cohorte ÷ su
        facturación neta; el gasto aplica ese % a las comisiones. Abre una cohorte para
        ver su facturación y el detalle por concepto.
      </p>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th rowSpan={2} className="sticky left-0 z-10 bg-muted px-3 py-2 text-left align-bottom font-semibold">
                  Cohorte
                </th>
                <GrupoTh tono="ingreso" colSpan={conPorDiferir ? 3 : 2}>
                  Ingreso F93/F94 de la cohorte
                </GrupoTh>
                <GrupoTh tono="gasto" colSpan={4}>
                  Gasto de comisiones
                </GrupoTh>
              </tr>
              <tr>
                <th className={cn("px-3 py-2 text-right font-semibold", DIVISOR)}>Ingreso del mes</th>
                <th className="px-3 py-2 text-right font-semibold">% del mes</th>
                {conPorDiferir && <th className="px-3 py-2 text-right font-semibold">Por diferir</th>}
                <th className={cn("px-3 py-2 text-right font-semibold", DIVISOR)}>Comisiones</th>
                <th className="px-3 py-2 text-right font-semibold">Gasto del mes</th>
                <th className="px-3 py-2 text-right font-semibold">Acumulado</th>
                <th className="px-3 py-2 text-right font-semibold">Pendiente</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {cohortes.map((c) => {
                const open = abiertas.has(c.cohorte);
                return (
                  <Fragment key={c.cohorte}>
                    <tr className={cn("group/fila align-top hover:bg-muted/40", open && "bg-muted/30")}>
                      <td className="sticky left-0 z-10 bg-card px-3 py-2 group-hover/fila:bg-muted">
                        <div className="flex items-start gap-1.5">
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-label={`${open ? "Ocultar" : "Ver"} detalle de ${periodoLabel(c.cohorte)}`}
                            onClick={() => toggle(c.cohorte)}
                            className="-m-0.5 shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ChevronRight
                              aria-hidden
                              className={cn("size-3.5 transition-transform", open && "rotate-90")}
                            />
                          </button>
                          <div className="flex flex-col">
                            <span className="flex items-center gap-1.5 whitespace-nowrap font-medium">
                              {periodoCorto(c.cohorte)}
                              {c.alertas.length > 0 && <AlertasCohorte cohorte={c} />}
                            </span>
                            {c.esPropia && (
                              <span className="text-xs text-muted-foreground">Cohorte del mes</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <Num value={formatImporte(c.ingresoMes)} className={DIVISOR} />
                      <Num value={formatFraction(c.pctMes, 4)} />
                      {conPorDiferir && (
                        <Num
                          value={c.pendienteIngreso === null ? "—" : formatImporte(c.pendienteIngreso)}
                          muted
                        />
                      )}
                      <Num value={formatImporte(c.comisiones)} muted className={DIVISOR} />
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                        <div className="flex flex-col items-end">
                          <span>{formatImporte(c.gastoMes + c.ajusteCierre)}</span>
                          {c.ajusteCierre !== 0 && (
                            <span className="text-xs font-normal text-muted-foreground">
                              incl. ajuste {formatImporte(c.ajusteCierre)}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        <div className="flex flex-col items-end">
                          <span>{formatImporte(c.acumulado)}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatFraction(c.pctAcumulado, 2)}
                          </span>
                        </div>
                      </td>
                      <Num value={formatImporte(c.pendiente)} />
                    </tr>
                    {open && (
                      <tr className="bg-muted/20">
                        <td colSpan={conPorDiferir ? 8 : 7} className="px-3 pb-3 pt-0">
                          <DetalleCohorte cohorte={c} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="divide-y divide-border border-t border-border bg-muted/30 font-mono font-semibold tabular-nums">
              {anio ? (
                <>
                  <FilaTotal label={`Total ${anio}`} tot={totales(cohortes)} conPorDiferir={conPorDiferir} />
                  <FilaTotal
                    label="Total del mes"
                    tot={totales(cierre.cohortes)}
                    conPorDiferir={conPorDiferir}
                    muted
                  />
                </>
              ) : (
                <FilaTotal label="Total" tot={totales(cierre.cohortes)} conPorDiferir={conPorDiferir} />
              )}
            </tfoot>
          </table>
        </div>
    </div>
  );
}

function FilaTotal({
  label,
  tot,
  conPorDiferir,
  muted,
}: {
  label: string;
  tot: Totales;
  conPorDiferir: boolean;
  muted?: boolean;
}) {
  return (
    <tr className={cn(muted && "font-normal text-muted-foreground")}>
      <td className="sticky left-0 z-10 whitespace-nowrap bg-muted px-3 py-2 font-sans text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </td>
      <td className={cn("px-3 py-2 text-right", DIVISOR)}>{formatImporte(tot.ingreso)}</td>
      <td />
      {conPorDiferir && (
        <td className="px-3 py-2 text-right">
          {tot.porDiferir === null ? "" : formatImporte(tot.porDiferir)}
        </td>
      )}
      <td className={cn("px-3 py-2 text-right", DIVISOR)}>{formatImporte(tot.comisiones)}</td>
      <td className="px-3 py-2 text-right">{formatImporte(tot.gasto)}</td>
      <td className="px-3 py-2 text-right">{formatImporte(tot.acumulado)}</td>
      <td className="px-3 py-2 text-right">{formatImporte(tot.pendiente)}</td>
    </tr>
  );
}

function AlertasCohorte({ cohorte: c }: { cohorte: CohorteCalculo }) {
  const grave = c.alertas.some((a) => a === "sin-base" || a === "sin-comisiones");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Alertas de ${periodoLabel(c.cohorte)}`}
          className={cn(
            "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            grave ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400",
          )}
        >
          <AlertTriangle className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ul className="flex flex-col gap-1">
          {c.alertas.map((a) => (
            <li key={a}>
              {ALERTA[a]}
              {a === "difiere-registro" && c.ingresoRegistrado !== null
                ? ` Registrado: ${formatCentavos(c.ingresoRegistrado)}.`
                : ""}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

function DetalleCohorte({ cohorte: c }: { cohorte: CohorteCalculo }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          Facturación neta de la cohorte{" "}
          <span className="font-mono tabular-nums text-foreground">
            {formatCentavos(c.baseNeta)}
          </span>
        </span>
        <span>
          Ingreso F94{" "}
          <span className="font-mono tabular-nums text-foreground">
            {formatCentavos(c.ingresoPorPrefijo.F94)}
          </span>
        </span>
        <span>
          Ingreso F93{" "}
          <span className="font-mono tabular-nums text-foreground">
            {formatCentavos(c.ingresoPorPrefijo.F93)}
          </span>
        </span>
        <span>
          % del mes{" "}
          <span className="font-mono tabular-nums text-foreground">
            {formatFraction(c.pctMes, 6)}
          </span>
        </span>
        {c.pendienteIngreso !== null && (
          <span>
            Ingreso por diferir de la cohorte{" "}
            <span className="font-mono tabular-nums text-foreground">
              {formatCentavos(c.pendienteIngreso)}
            </span>
          </span>
        )}
      </div>
      {c.conceptos.some((k) => k.registrado) && (
        <p className="text-xs text-muted-foreground">
          {c.conceptos.find((k) => k.registrado)?.registrado}
        </p>
      )}
      {c.conceptos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin comisiones registradas.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-3 text-left font-semibold">Concepto</th>
              <th className="px-3 py-1.5 text-left font-semibold">Cuenta</th>
              <th className="px-3 py-1.5 text-right font-semibold">Comisiones</th>
              <th className="px-3 py-1.5 text-right font-semibold">Reconocido antes</th>
              <th className="px-3 py-1.5 text-right font-semibold">Gasto del mes</th>
              {c.ajusteCierre !== 0 && (
                <th className="px-3 py-1.5 text-right font-semibold">Ajuste de cierre</th>
              )}
              <th className="px-3 py-1.5 text-right font-semibold">Acumulado</th>
              <th className="py-1.5 pl-3 text-right font-semibold">Pendiente</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono tabular-nums">
            {c.conceptos.map((k) => (
              <tr key={k.conceptoId}>
                <td className="py-1.5 pr-3 font-sans">{k.nombre}</td>
                <td className="px-3 py-1.5">{k.cuenta ?? "—"}</td>
                <td className="px-3 py-1.5 text-right">{formatImporte(k.valor)}</td>
                <td className="px-3 py-1.5 text-right">{formatImporte(k.previo)}</td>
                <td className="px-3 py-1.5 text-right font-medium">{formatImporte(k.gastoMes)}</td>
                {c.ajusteCierre !== 0 && (
                  <td className="px-3 py-1.5 text-right">{formatImporte(k.ajusteCierre)}</td>
                )}
                <td className="px-3 py-1.5 text-right">{formatImporte(k.acumulado)}</td>
                <td className="py-1.5 pl-3 text-right">{formatImporte(k.pendiente)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Separa el bloque de ingreso del de gasto en las tablas. */
const DIVISOR = "border-l border-border";

function GrupoTh({
  tono,
  colSpan,
  children,
}: {
  tono: TonoGrupo;
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <th
      colSpan={colSpan}
      scope="colgroup"
      className={cn("px-3 py-1.5 text-left font-semibold", DIVISOR, TONO_GRUPO[tono].th)}
    >
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={cn("size-1.5 rounded-full", TONO_GRUPO[tono].dot)} />
        {children}
      </span>
    </th>
  );
}

function Num({
  value,
  strong,
  muted,
  className,
}: {
  value: string;
  strong?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 text-right font-mono tabular-nums",
        strong && "font-semibold",
        muted && "text-muted-foreground",
        className,
      )}
    >
      {value}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Asientos

function AsientosLista({ asientos, anio }: { asientos: Asiento[]; anio: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Diferimiento de la cohorte del mes, amortización de cada cohorte anterior y, si
        aplica, ajuste por cierre de cohorte, contra la cuenta 17109501. Todos cuadran
        débito = crédito. "Copiar" deja las líneas listas para pegar (cuenta, nombre,
        débito, crédito).
      </p>
      {asientos.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {anio ? `No hay asientos de cohortes ${anio} este mes.` : "No hay asientos para este mes."}
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {asientos.map((a) => {
          const t = totalesAsiento(a);
          return (
            <div key={a.id} className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[520px] text-xs">
                <caption className="border-b border-border bg-muted/40 px-3 py-1 text-left text-xs font-medium">
                  <span className="flex items-center justify-between gap-2">
                    {a.descripcion}
                    <CopiarAsiento asiento={a} />
                  </span>
                </caption>
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-1.5 text-left font-semibold">Cuenta</th>
                    <th className="px-3 py-1.5 text-left font-semibold">Nombre</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Débito</th>
                    <th className="px-3 py-1.5 text-right font-semibold">Crédito</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono tabular-nums">
                  {a.lineas.map((l, i) => (
                    <tr key={`${l.cuenta}-${i}`}>
                      <td className="px-3 py-1.5">{l.cuenta || "—"}</td>
                      <td className="px-3 py-1.5 font-sans">{l.nombre}</td>
                      <td className="px-3 py-1.5 text-right">{l.debito ? formatCentavos(l.debito) : ""}</td>
                      <td className="px-3 py-1.5 text-right">{l.credito ? formatCentavos(l.credito) : ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border font-mono font-semibold tabular-nums">
                  <tr>
                    <td colSpan={2} className="px-3 py-1.5 font-sans">
                      Total
                      {t.debito !== t.credito && (
                        <span className="ml-2 text-destructive">No cuadra</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">{formatCentavos(t.debito)}</td>
                    <td className="px-3 py-1.5 text-right">{formatCentavos(t.credito)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado y controles

/** Muestra lo que requiere atención; los controles correctos quedan resumidos en una línea. */
function ControlesList({ controles }: { controles: Control[] }) {
  const [verCorrectos, setVerCorrectos] = useState(false);
  const correctos = controles.filter((c) => c.estado === "ok").length;
  const visibles = verCorrectos ? controles : controles.filter((c) => c.estado !== "ok");

  return (
    <div className="flex flex-col gap-2.5">
      {visibles.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {visibles.map((c, i) => (
            <li key={`${c.id}-${i}`} className="flex items-start gap-2.5">
              <ControlIcon estado={c.estado} />
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{c.titulo}</span>
                <span className="text-xs text-muted-foreground">{c.detalle}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {correctos > 0 && (
        <div className="flex items-start gap-2.5 text-sm">
          {!verCorrectos && <ControlIcon estado="ok" />}
          {!verCorrectos && (
            <span className="text-muted-foreground">
              {correctos === controles.length
                ? "Todos los controles están correctos"
                : `${correctos} control${correctos === 1 ? "" : "es"} correcto${correctos === 1 ? "" : "s"}`}
            </span>
          )}
          <button
            type="button"
            aria-expanded={verCorrectos}
            onClick={() => setVerCorrectos((v) => !v)}
            className="rounded-sm text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
          >
            {verCorrectos ? "Ocultar correctos" : "Ver detalle"}
          </button>
        </div>
      )}
    </div>
  );
}

const CONTROL_ICON: Record<
  EstadoControl,
  { icon: typeof Info; label: string; className: string }
> = {
  ok: { icon: CheckCircle2, label: "Correcto", className: "text-emerald-600 dark:text-emerald-400" },
  warning: { icon: AlertTriangle, label: "Advertencia", className: "text-amber-600 dark:text-amber-400" },
  error: { icon: XCircle, label: "Error", className: "text-rose-600 dark:text-rose-400" },
  info: { icon: Info, label: "Información", className: "text-sky-600 dark:text-sky-400" },
};

function ControlIcon({ estado }: { estado: EstadoControl }) {
  const { icon: Icon, label, className } = CONTROL_ICON[estado];
  return (
    <Icon role="img" aria-label={label} className={cn("mt-0.5 size-4 shrink-0", className)} />
  );
}

/** Importe para pegar en NetSuite o Excel: sin miles, coma decimal. */
const paraPegar = (centavos: number) => (centavos / 100).toFixed(2).replace(".", ",");

function CopiarAsiento({ asiento }: { asiento: Asiento }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    const filas = asiento.lineas.map((l) =>
      [l.cuenta, l.nombre, l.debito ? paraPegar(l.debito) : "", l.credito ? paraPegar(l.credito) : ""].join("\t"),
    );
    try {
      await navigator.clipboard.writeText(filas.join("\n"));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-xs"
      onClick={() => void copiar()}
      aria-label={`Copiar líneas de ${asiento.descripcion}`}
    >
      {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copiado ? "Copiado" : "Copiar"}
    </Button>
  );
}

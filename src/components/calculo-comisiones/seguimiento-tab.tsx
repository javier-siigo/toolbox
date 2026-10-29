"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Table2, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  calcularSeguimiento,
  periodoCorto,
  periodoLabel,
  type DatosComisiones,
  type Seguimiento,
} from "@/lib/comisiones/calculo";
import type { CierreGuardado } from "@/lib/comisiones/types";
import { cn } from "@/lib/utils";

import { formatFraction, formatImporte, formatPesos, formatShortDateTime } from "./format";
import { GrupoTitulo } from "./grupo";

const NOTA_COLOR = {
  registrado: "bg-amber-500",
  cierre: "bg-foreground/60",
  tope: "bg-foreground/60",
} as const;

const NOTA = {
  registrado: "Valor contabilizado a mano; reemplaza la fórmula",
  cierre: "Ajuste por cierre: la cohorte terminó de reconocer ingreso",
  tope: "Cierre de la cohorte: se registró solo el saldo pendiente",
} as const;

interface SeguimientoTabProps {
  datos: DatosComisiones;
  cierres: CierreGuardado[];
  onAbrir: (periodo: string) => void;
  /** Sin handler (nivel `ver`) no se ofrece eliminar. */
  onEliminar?: (periodo: string) => Promise<void>;
}

export function SeguimientoTab({ datos, cierres, onAbrir, onEliminar }: SeguimientoTabProps) {
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const seg = useMemo(() => calcularSeguimiento(datos), [datos]);

  if (seg.filas.length === 0 && cierres.length === 0) {
    return (
      <EmptyState
        icon={<Table2 className="size-7" />}
        title="Aún no hay cohortes"
        description="Cuando registres las comisiones de un mes, su reconocimiento aparecerá aquí mes a mes."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <MatrizSeguimiento seg={seg} />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Cierres guardados</CardTitle>
          <CardDescription>
            Los meses anteriores al portal vienen del Excel de reconocimiento y no
            tienen cierre guardado.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {cierres.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              Aún no hay cierres guardados desde el portal.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold">Periodo</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Gasto del mes</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Diferido del mes</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Saldo 17109501</th>
                    <th className="px-3 py-2.5 text-left font-semibold">Guardado</th>
                    <th className="w-24" aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cierres.map((c) => (
                    <tr key={c.id} className="hover:bg-muted/40">
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col">
                          <span className="font-medium">{periodoLabel(c.periodo)}</span>
                          <span
                            className="max-w-56 truncate text-xs text-muted-foreground"
                            title={c.archivoNombre}
                          >
                            {c.archivoNombre}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono font-medium tabular-nums">
                        {formatPesos(c.gastoMes)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatPesos(c.diferidoNuevo)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatPesos(c.saldoDiferido)}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {formatShortDateTime(c.createdAt)}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Abrir ${periodoLabel(c.periodo)}`}
                            onClick={() => onAbrir(c.periodo)}
                          >
                            <ArrowRight className="size-4" />
                          </Button>
                          {onEliminar && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
                              )}
                              aria-label={`Eliminar cierre de ${periodoLabel(c.periodo)}`}
                              onClick={() => setConfirmar(c.periodo)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmar !== null} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Eliminar cierre de {confirmar ? periodoLabel(confirmar) : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Se borran los asientos guardados y el ingreso que se leyó del informe
              para ese mes, así que el gasto de ese mes deja de contar en el
              seguimiento. Las comisiones y la facturación se conservan; puedes
              volver a cargar el informe y guardar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmar) void onEliminar?.(confirmar);
                setConfirmar(null);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Vista = "gasto" | "ingreso";

const TH = "px-3 py-2 text-right font-semibold whitespace-nowrap";
const TD = "px-3 py-2 text-right whitespace-nowrap";
const STICKY_TH = "sticky left-0 z-10 bg-muted px-3 py-2 text-left font-semibold";
const STICKY_TD = "sticky left-0 z-10 bg-card px-3 py-2 font-sans font-medium whitespace-nowrap";

const VENTANA = 12;

function MatrizSeguimiento({ seg }: { seg: Seguimiento }) {
  const [vista, setVista] = useState<Vista>("gasto");
  const [todos, setTodos] = useState(false);
  const periodos = todos ? seg.periodos : seg.periodos.slice(-VENTANA);
  // Cohortes cerradas sin movimiento en la ventana visible no aportan: se ocultan.
  const filas = todos
    ? seg.filas
    : seg.filas.filter(
        (f) => f.pendiente !== 0 || periodos.some((p) => f.porPeriodo.has(p) && !f.porPeriodo.get(p)!.cerrada),
      );
  const ocultas = seg.filas.length - filas.length;
  // La matriz abre en los meses más recientes; los anteriores quedan a la izquierda.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const alFinal = () => (el.scrollLeft = el.scrollWidth);
    alFinal();
    // La tabla cambia de ancho cuando cargan las fuentes: vuelve a alinear.
    const ro = new ResizeObserver(alFinal);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    const t = setTimeout(() => ro.disconnect(), 1500);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [vista, todos, periodos.length]);
  const totales = filas.reduce(
    (a, f) => ({
      comisiones: a.comisiones + f.comisiones,
      base: a.base + f.baseNeta,
      ingreso: a.ingreso + f.ingresoAcumulado,
      acumulado: a.acumulado + f.acumulado,
      pendiente: a.pendiente + f.pendiente,
    }),
    { comisiones: 0, base: 0, ingreso: 0, acumulado: 0, pendiente: 0 },
  );
  const gasto = vista === "gasto";

  return (
    <Card>
      <CardHeader className="gap-3 space-y-0 pb-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-sm">
            <GrupoTitulo tono={vista}>
              {gasto ? "Gasto de comisiones por cohorte" : "Ingreso F93/F94 por cohorte"}
            </GrupoTitulo>
          </CardTitle>
          <CardDescription>
            {gasto
              ? "Cada fila es el mes en que se causaron las comisiones; cada columna, el mes en que se llevan al gasto. Debajo, el % del mes."
              : "Cada fila son las facturas emitidas en un mes; cada columna, el ingreso que se les reconoce en ese mes. Debajo, el % sobre su facturación neta: es el % que se aplica a las comisiones."}
          </CardDescription>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
            <span>Valores en pesos. Abre en los meses recientes; desliza a la izquierda para ver los anteriores.</span>
            {seg.periodos.length > VENTANA && (
              <button
                type="button"
                onClick={() => setTodos((t) => !t)}
                className="rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {todos
                  ? `Ver los últimos ${VENTANA} meses`
                  : `Ver los ${seg.periodos.length} meses${ocultas ? ` y ${ocultas} cohortes cerradas` : ""}`}
              </button>
            )}
          </div>
          {gasto && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn("size-1.5 rounded-full", NOTA_COLOR.cierre)} />
                Cierre de la cohorte (saldo o ajuste)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn("size-1.5 rounded-full", NOTA_COLOR.registrado)} />
                Valor contabilizado a mano
              </span>
            </div>
          )}
        </div>
        <Tabs value={vista} onValueChange={(v) => setVista(v as Vista)}>
          <TabsList>
            <TabsTrigger value="gasto">Gasto</TabsTrigger>
            <TabsTrigger value="ingreso">Ingreso</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        <div ref={scrollRef} className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className={STICKY_TH}>Cohorte</th>
                <th className={TH}>{gasto ? "Comisiones" : "Facturación neta"}</th>
                {periodos.map((p) => (
                  <th key={p} className={TH}>
                    {periodoCorto(p)}
                  </th>
                ))}
                <th className={TH}>{gasto ? "Acumulado" : "Ingreso acumulado"}</th>
                {gasto && <th className={TH}>Pendiente</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono tabular-nums">
              {filas.map((f) => (
                <tr key={f.cohorte} className="hover:bg-muted/40">
                  <td className={STICKY_TD}>{periodoCorto(f.cohorte)}</td>
                  <td className={cn(TD, "text-muted-foreground")}>
                    {formatImporte(gasto ? f.comisiones : f.baseNeta)}
                  </td>
                  {periodos.map((p) => {
                    const c = f.porPeriodo.get(p);
                    const vacio = !c || (gasto && c.cerrada);
                    return (
                      <td key={p} className={TD}>
                        {vacio ? (
                          <span className="text-muted-foreground/50">
                            {p < f.cohorte || c?.cerrada ? "" : "—"}
                          </span>
                        ) : (
                          <div className="flex flex-col items-end">
                            <span className="inline-flex items-center gap-1">
                              {gasto && c.nota && (
                                <span
                                  title={NOTA[c.nota]}
                                  aria-label={NOTA[c.nota]}
                                  className={cn("size-1.5 rounded-full", NOTA_COLOR[c.nota])}
                                />
                              )}
                              {formatImporte(gasto ? c.gasto : c.ingreso)}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {formatFraction(c.pct, 2)}
                            </span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className={TD}>
                    <div className="flex flex-col items-end">
                      <span>{formatImporte(gasto ? f.acumulado : f.ingresoAcumulado)}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatFraction(
                          gasto
                            ? f.comisiones
                              ? f.acumulado / f.comisiones
                              : 0
                            : f.baseNeta
                              ? f.ingresoAcumulado / f.baseNeta
                              : 0,
                          2,
                        )}
                      </span>
                    </div>
                  </td>
                  {gasto && (
                    <td className={cn(TD, "font-medium")}>{formatImporte(f.pendiente)}</td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-border bg-muted/30 font-mono font-semibold tabular-nums">
              <tr>
                <td className="sticky left-0 z-10 bg-muted px-3 py-2 font-sans text-[11px] uppercase tracking-wide text-muted-foreground">
                  {gasto ? "Gasto del mes" : "Ingreso del mes"}
                </td>
                <td className={TD}>{formatImporte(gasto ? totales.comisiones : totales.base)}</td>
                {periodos.map((p) => (
                  <td key={p} className={TD}>
                    {formatImporte(
                      (gasto ? seg.totalPorPeriodo : seg.ingresoPorPeriodo).get(p) ?? 0,
                    )}
                  </td>
                ))}
                <td className={TD}>{formatImporte(gasto ? totales.acumulado : totales.ingreso)}</td>
                {gasto && <td className={TD}>{formatImporte(totales.pendiente)}</td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

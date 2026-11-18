"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, ChevronDown, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { ComoUsar } from "@/components/tour/como-usar";
import { Button } from "@/components/ui/button";
import { SoloLectura } from "@/components/common/solo-lectura";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  actualizarConcepto,
  crearConcepto,
  eliminarCierre,
  guardarBase,
  guardarCierre,
  guardarValores,
  type ComisionesData,
} from "@/lib/comisiones/actions";
import {
  aCentavos,
  aPesos,
  calcularCierre,
  periodoLabel,
  shiftPeriodo,
  type DatosComisiones,
} from "@/lib/comisiones/calculo";
import { construirControles } from "@/lib/comisiones/controles";
import {
  type BasePeriodo,
  type CierreGuardado,
  type Concepto,
  type Control,
  type GastoRegistrado,
  type PrefijoComision,
  type Reconocimiento,
  type ValorPeriodo,
} from "@/lib/comisiones/types";

import { BasePanel, type BaseMes } from "./base-panel";
import { ConceptosPanel } from "./conceptos-panel";
import { DocumentosTable } from "./documentos-table";
import { DatoTile } from "./dato-tile";
import { formatCentavos, formatNumber, formatPesos } from "./format";
import { AyudaDato, Termino } from "./glosario";
import { PeriodoPicker } from "./periodo-picker";
import { RevisionPanel, type VistaDetalle } from "./revision-panel";
import { InformePanel } from "./informe-panel";
import { ResultadoCard } from "./resultado-card";
import { SeguimientoTab } from "./seguimiento-tab";
import { construirTareas, type DatoMes, type DestinoTarea } from "./tareas";
import { TOUR_COMISIONES } from "./tour";
import { useInformeDiferido } from "./use-informe-diferido";

interface CalculoComisionesPageClientProps {
  data: ComisionesData;
  periodoInicial: string;
  periodoMax: string;
  /** Error al cargar desde Supabase; la lectura del informe sigue funcionando. */
  errorDatos?: string | null;
  /** Nivel `ver`: consulta, carga el informe y exporta, pero no guarda nada. */
  soloLectura?: boolean;
}

function valoresDe(valores: ValorPeriodo[], periodo: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of valores) if (v.periodo === periodo) m.set(v.conceptoId, v.valor);
  return m;
}

function setValor(
  valores: ValorPeriodo[],
  periodo: string,
  conceptoId: string,
  valor: number,
): ValorPeriodo[] {
  const rest = valores.filter((v) => !(v.periodo === periodo && v.conceptoId === conceptoId));
  return [...rest, { periodo, conceptoId, valor }];
}

function baseDe(bases: BasePeriodo[], periodo: string): BaseMes {
  const out: BaseMes = {
    F94: { facturas: 0, notasCredito: 0 },
    F93: { facturas: 0, notasCredito: 0 },
  };
  for (const b of bases) {
    if (b.periodo === periodo) out[b.prefijo] = { facturas: b.facturas, notasCredito: b.notasCredito };
  }
  return out;
}

export function CalculoComisionesPageClient({
  data,
  periodoInicial,
  periodoMax,
  errorDatos = null,
  soloLectura = false,
}: CalculoComisionesPageClientProps) {
  const [conceptos, setConceptos] = useState<Concepto[]>(data.conceptos);
  const [valores, setValores] = useState<ValorPeriodo[]>(data.valores);
  const [bases, setBases] = useState<BasePeriodo[]>(data.bases);
  const [reconocimientos, setReconocimientos] = useState<Reconocimiento[]>(data.reconocimientos);
  const [registrados, setRegistrados] = useState<GastoRegistrado[]>(data.registrados);
  const [cierres, setCierres] = useState<CierreGuardado[]>(data.cierres);

  // Las server actions revalidan la ruta: sincroniza con los datos frescos.
  useEffect(() => {
    setConceptos(data.conceptos);
    setValores(data.valores);
    setBases(data.bases);
    setReconocimientos(data.reconocimientos);
    setRegistrados(data.registrados);
    setCierres(data.cierres);
  }, [data]);

  const [tab, setTab] = useState<"cierre" | "seguimiento">("cierre");
  const [periodo, setPeriodo] = useState(periodoInicial);
  const [guardando, setGuardando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const { state: lectura, leer, limpiar, exportar } = useInformeDiferido();
  const archivo = lectura.estado === "listo" ? lectura.resultado : null;

  // Soltar el Excel en cualquier parte de la página, en cualquier estado.
  const [arrastrando, setArrastrando] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setArrastrando(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setArrastrando(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = 0;
      setArrastrando(false);
      // La zona de la tarjeta "Informe diferido" ya lo procesó.
      if (e.defaultPrevented) return;
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        toast.error("El informe debe ser un archivo .xlsx.");
        return;
      }
      setTab("cierre");
      leer(file);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [leer]);

  // Si el archivo es de otro mes, se cambia al periodo del archivo.
  const ajustadoRef = useRef<object | null>(null);
  useEffect(() => {
    if (!archivo || ajustadoRef.current === archivo) return;
    ajustadoRef.current = archivo;
    const detectado = archivo.periodoDetectado;
    if (detectado && detectado !== periodo && detectado <= periodoMax) {
      setPeriodo(detectado);
      toast.info(`El informe es de ${periodoLabel(detectado)}; se cambió el periodo.`);
    }
  }, [archivo, periodo, periodoMax]);

  const datos = useMemo<DatosComisiones>(
    () => ({ conceptos, valores, bases, reconocimientos, registrados }),
    [conceptos, valores, bases, reconocimientos, registrados],
  );

  const valoresPeriodo = useMemo(() => valoresDe(valores, periodo), [valores, periodo]);
  const valoresAnterior = useMemo(
    () => valoresDe(valores, shiftPeriodo(periodo, -1)),
    [valores, periodo],
  );
  const pool = [...valoresPeriodo.values()].reduce((a, v) => a + v, 0);
  const baseMes = useMemo(() => baseDe(bases, periodo), [bases, periodo]);

  const guardado = cierres.find((c) => c.periodo === periodo) ?? null;
  const tieneRegistro = useMemo(
    () => reconocimientos.some((r) => r.periodo === periodo),
    [reconocimientos, periodo],
  );

  const cierre = useMemo(() => {
    if (archivo) return calcularCierre(datos, { periodo, ingresosArchivo: archivo.ingresos });
    if (tieneRegistro) return calcularCierre(datos, { periodo, ingresosArchivo: null });
    return null;
  }, [archivo, tieneRegistro, datos, periodo]);

  const controles = useMemo<Control[]>(() => {
    if (!cierre) return [];
    const base = construirControles(cierre, archivo);
    // El cierre guardado ya no coincide con los datos actuales (p. ej. se
    // corrigió una comisión después de guardar): hay que registrar la diferencia.
    if (guardado && !archivo) {
      const dif = cierre.gastoMes - aCentavos(guardado.gastoMes);
      if (dif !== 0) {
        base.unshift({
          id: "diferencia-guardado",
          titulo: "Diferencia con el cierre guardado",
          detalle: `Con los datos actuales el gasto del mes es ${formatCentavos(cierre.gastoMes)}; el cierre guardado registró ${formatCentavos(aCentavos(guardado.gastoMes))}. Diferencia a registrar: ${formatCentavos(dif)}.`,
          estado: "warning",
        });
      }
    }
    return base;
  }, [cierre, archivo, guardado]);

  const sinGuardar =
    !!archivo &&
    !!cierre &&
    (!guardado ||
      guardado.archivoNombre !== archivo.archivoNombre ||
      aCentavos(guardado.gastoMes) !== cierre.gastoMes ||
      aCentavos(guardado.diferidoNuevo) !== cierre.diferidoNuevo ||
      aCentavos(guardado.saldoDiferido) !== cierre.saldoDiferido);

  // --- Conceptos -----------------------------------------------------------

  const onValor = async (conceptoId: string, valor: number) => {
    const prev = valores;
    setValores((vs) => setValor(vs, periodo, conceptoId, valor));
    const res = await guardarValores(periodo, [{ conceptoId, valor }]);
    if (!res.ok) {
      setValores(prev);
      toast.error(res.error);
    }
  };

  const onCopiarAnterior = async () => {
    const items = conceptos
      .filter((c) => c.activo && valoresAnterior.has(c.id))
      .map((c) => ({ conceptoId: c.id, valor: valoresAnterior.get(c.id) ?? 0 }));
    const prev = valores;
    setValores((vs) => items.reduce((acc, i) => setValor(acc, periodo, i.conceptoId, i.valor), vs));
    const res = await guardarValores(periodo, items);
    if (!res.ok) {
      setValores(prev);
      toast.error(res.error);
    } else {
      toast.success(`Valores copiados de ${periodoLabel(shiftPeriodo(periodo, -1))}`);
    }
  };

  const onCrear = async (nombre: string) => {
    const res = await crearConcepto(nombre);
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setConceptos((cs) => [...cs, res.data]);
    return true;
  };

  const patchConcepto = async (
    id: string,
    patch: { nombre?: string; activo?: boolean; cuenta?: string | null },
  ) => {
    const prev = conceptos;
    setConceptos((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const res = await actualizarConcepto(id, patch);
    if (!res.ok) {
      setConceptos(prev);
      toast.error(res.error);
    }
  };

  // --- Facturación ---------------------------------------------------------

  const onBase = async (
    prefijo: PrefijoComision,
    campo: "facturas" | "notasCredito",
    valor: number,
  ) => {
    const actual = baseMes[prefijo];
    const nueva: BasePeriodo = { periodo, prefijo, ...actual, [campo]: valor };
    const prev = bases;
    setBases((bs) => [
      ...bs.filter((b) => !(b.periodo === periodo && b.prefijo === prefijo)),
      nueva,
    ]);
    const res = await guardarBase(nueva);
    if (!res.ok) {
      setBases(prev);
      toast.error(res.error);
    }
  };

  // --- Cierre --------------------------------------------------------------

  const onGuardar = async () => {
    if (!cierre || !archivo) return;
    const bloqueante = controles.find((c) => c.estado === "error");
    if (bloqueante) {
      toast.error(`${bloqueante.titulo}: ${bloqueante.detalle}`);
      return;
    }
    setGuardando(true);
    const recon = archivo.ingresos
      .filter((i) => i.cohorte <= periodo)
      .map((i) => ({
        cohorte: i.cohorte,
        prefijo: i.prefijo,
        ingreso: i.ingreso,
        pendienteIngreso: i.pendiente,
      }));
    const res = await guardarCierre({
      periodo,
      archivoNombre: archivo.archivoNombre,
      archivoTamano: archivo.archivoTamano,
      reconocimientos: recon,
      gastoMes: aPesos(cierre.gastoMes),
      diferidoNuevo: aPesos(cierre.diferidoNuevo),
      saldoDiferido: aPesos(cierre.saldoDiferido),
      asientos: cierre.asientos,
      controles,
    });
    setGuardando(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const createdAt = new Date().toISOString();
    setReconocimientos((rs) => [
      ...rs.filter((r) => r.periodo !== periodo),
      ...recon.map((r) => ({ ...r, periodo, fuente: "informe" as const })),
    ]);
    setCierres((cs) =>
      [
        {
          id: guardado?.id ?? `local-${periodo}`,
          periodo,
          archivoNombre: archivo.archivoNombre,
          archivoTamano: archivo.archivoTamano,
          gastoMes: aPesos(cierre.gastoMes),
          diferidoNuevo: aPesos(cierre.diferidoNuevo),
          saldoDiferido: aPesos(cierre.saldoDiferido),
          asientos: cierre.asientos,
          controles,
          createdAt,
        },
        ...cs.filter((c) => c.periodo !== periodo),
      ].sort((a, b) => b.periodo.localeCompare(a.periodo)),
    );
    toast.success(`Cierre de ${periodoLabel(periodo)} guardado`);
  };

  const onExportar = async () => {
    if (!cierre) return;
    setExportando(true);
    try {
      const buffer = archivo
        ? await exportar({ cierre, controles })
        : await import("@/lib/comisiones/exportar").then((m) =>
            m.construirExcel(null, { cierre, controles }),
          );
      const url = URL.createObjectURL(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `comisiones-${periodo}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo exportar.");
    } finally {
      setExportando(false);
    }
  };

  const onEliminar = async (p: string) => {
    const prevCierres = cierres;
    const prevRecon = reconocimientos;
    setCierres((cs) => cs.filter((c) => c.periodo !== p));
    setReconocimientos((rs) => rs.filter((r) => !(r.periodo === p && r.fuente === "informe")));
    const res = await eliminarCierre(p);
    if (!res.ok) {
      setCierres(prevCierres);
      setReconocimientos(prevRecon);
      toast.error(res.error);
    } else {
      toast.success(`Cierre de ${periodoLabel(p)} eliminado`);
    }
  };

  // --- Datos del mes ------------------------------------------------------

  const mes = periodoLabel(periodo).toLowerCase();
  const netoMes = baseMes.F94.facturas - baseMes.F94.notasCredito + baseMes.F93.facturas - baseMes.F93.notasCredito;
  const leyendo = lectura.estado === "leyendo";
  const listo: Record<DatoMes, boolean> = {
    comisiones: pool !== 0,
    facturacion: netoMes > 0,
    informe: !!archivo || tieneRegistro,
  };
  const faltante = DATOS.find((d) => !listo[d]) ?? null;
  const listos = DATOS.filter((d) => listo[d]).length;

  // El editor abierto. Al cambiar de mes se abre el primer dato que falta; después
  // manda lo que elija el usuario (no salta a otro dato mientras se escribe).
  const [eleccion, setEleccion] = useState<{ periodo: string; dato: DatoMes | null }>(() => ({
    periodo,
    dato: faltante,
  }));
  if (eleccion.periodo !== periodo) setEleccion({ periodo, dato: faltante });
  const abierto = leyendo ? "informe" : eleccion.dato;
  const abrir = (dato: DatoMes | null) => setEleccion({ periodo, dato });
  const toggleDato = (dato: DatoMes) => abrir(abierto === dato ? null : dato);
  const cargar = (file: File) => {
    abrir("informe");
    leer(file);
  };

  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const [vista, setVista] = useState<VistaDetalle>("cohortes");

  const irA = (id: string) =>
    requestAnimationFrame(() =>
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );

  const onTarea = (destino: DestinoTarea) => {
    if (destino.tipo === "dato") {
      abrir(destino.dato);
      irA("datos-mes");
    } else if (destino.tipo === "detalle") {
      setVista(destino.vista);
      setDetalleAbierto(true);
      irA("detalle-mes");
    } else {
      setPeriodo(destino.periodo);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const tareas = useMemo(() => (cierre ? construirTareas(controles, cierre) : []), [controles, cierre]);

  const sinCuenta = conceptos.filter((c) => !c.cuenta && (valoresPeriodo.get(c.id) ?? 0) !== 0).length;

  return (
    <div className="flex flex-col gap-5">
      {arrastrando && (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6"
        >
          <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-primary bg-card px-10 py-12 text-center shadow-lg">
            <Upload className="size-8 text-primary" />
            <span className="text-base font-semibold">Suelta el informe diferido</span>
            <span className="text-sm text-muted-foreground">
              Se toma el ingreso de las facturas con DOC ORIGEN F93 y F94
            </span>
          </div>
        </div>
      )}

      {soloLectura && <SoloLectura />}

      {errorDatos && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">No se pudieron cargar las comisiones ni el histórico.</span>
            <span className="text-xs opacity-90">
              Revisa que las migraciones de comisiones estén aplicadas en Supabase. ({errorDatos})
            </span>
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-0">
        <header className="flex w-full flex-col gap-4 pb-1 xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-base font-semibold tracking-tight text-foreground">
              Cálculo de Comisiones
            </h1>
            <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
              Las comisiones de cada mes se llevan al gasto al mismo ritmo en que se
              reconoce el ingreso de sus facturas F93 y F94. Trae los tres datos del mes y
              el resultado se calcula solo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 xl:flex-nowrap xl:justify-end">
            <ComoUsar steps={TOUR_COMISIONES} className="h-9" />
            <TabsList>
              <TabsTrigger value="cierre">Cierre del mes</TabsTrigger>
              <TabsTrigger value="seguimiento" data-tour="seguimiento">
                Seguimiento
              </TabsTrigger>
            </TabsList>
            <PeriodoPicker
              value={periodo}
              onChange={setPeriodo}
              max={periodoMax}
              guardados={new Set(cierres.map((c) => c.periodo))}
            />
          </div>
        </header>

        <TabsContent value="cierre" className="flex flex-col gap-8 pt-5">
          <section id="datos-mes" aria-labelledby="datos-titulo" className="flex scroll-mt-20 flex-col gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="datos-titulo" className="text-sm font-semibold">
                Lo que necesitas traer de {mes}
              </h2>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {listos} de {DATOS.length} listos
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <DatoTile
                id="comisiones"
                titulo="Comisiones del mes"
                tipo="gasto"
                estado={listo.comisiones ? "listo" : "falta"}
                siguiente={faltante === "comisiones"}
                valor={pool !== 0 ? formatPesos(pool) : undefined}
                detalle={
                  pool === 0
                    ? `Lo causado en ${mes}, por concepto`
                    : sinCuenta > 0
                      ? `${valoresPeriodo.size} conceptos · ${sinCuenta === 1 ? "1 sin cuenta" : `${sinCuenta} sin cuenta`}`
                      : `${valoresPeriodo.size} conceptos, todos con cuenta`
                }
                accion={listo.comisiones ? "Ver o editar" : "Registrar"}
                abierto={abierto === "comisiones"}
                onToggle={() => toggleDato("comisiones")}
              />
              <DatoTile
                id="facturacion"
                titulo={
                  <>
                    Facturación <Termino t="f93f94">F93/F94</Termino>
                  </>
                }
                tipo="ingreso"
                estado={listo.facturacion ? "listo" : "falta"}
                siguiente={faltante === "facturacion"}
                valor={netoMes !== 0 ? formatPesos(netoMes) : undefined}
                detalle={netoMes !== 0 ? "Neto: facturas menos notas crédito" : `Lo facturado en ${mes}, según NetSuite`}
                accion={listo.facturacion ? "Ver o editar" : "Ingresar"}
                abierto={abierto === "facturacion"}
                onToggle={() => toggleDato("facturacion")}
              />
              <DatoTile
                id="informe"
                titulo={<Termino t="informe">Informe diferido</Termino>}
                tipo="ingreso"
                estado={leyendo ? "leyendo" : listo.informe ? "listo" : "falta"}
                siguiente={faltante === "informe"}
                valorTexto
                valor={
                  archivo ? archivo.archivoNombre : leyendo ? lectura.archivo.name : tieneRegistro ? "Ingreso ya registrado" : undefined
                }
                detalle={
                  archivo
                    ? `${formatNumber(archivo.documentos.length)} comprobantes F93/F94`
                    : leyendo
                      ? "Se lee en tu navegador"
                      : tieneRegistro
                        ? guardado
                          ? "Del cierre guardado"
                          : "Del Excel de contabilidad"
                        : "El Excel del mes · o arrástralo a la página"
                }
                accion={archivo ? "Ver o cambiar" : tieneRegistro ? "Cargar para recalcular" : "Subir informe"}
                abierto={abierto === "informe"}
                onToggle={() => toggleDato("informe")}
              />
            </div>

            {abierto && (
              <div
                id="dato-editor"
                className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold">{EDITOR_TITULO[abierto](mes)}</h3>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="-mr-2 -mt-1.5 size-8"
                    aria-label="Cerrar"
                    onClick={() => abrir(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>

                {abierto === "comisiones" && (
                  <>
                    <AyudaDato
                      que={
                        <>
                          Lo que se causó en comisiones en {mes}, por concepto. No va todo al gasto
                          de una vez: es la <Termino t="cohorte">cohorte</Termino> del mes y se reparte
                          a medida que se reconoce el ingreso de sus facturas.
                        </>
                      }
                      donde={
                        <>
                          Del soporte de comisiones causadas del mes. Cada concepto necesita su
                          cuenta de gasto. Si casi no cambió, copia el mes anterior y ajusta.
                        </>
                      }
                    />
                    <fieldset disabled={soloLectura} className="contents">
                      <ConceptosPanel
                        periodo={periodo}
                        conceptos={conceptos}
                        valores={valoresPeriodo}
                        valoresAnterior={valoresAnterior}
                        pool={pool}
                        onValor={(id, v) => void onValor(id, v)}
                        onCrear={onCrear}
                        onRenombrar={(id, nombre) => void patchConcepto(id, { nombre })}
                        onCuenta={(id, cuenta) => void patchConcepto(id, { cuenta: cuenta.trim() || null })}
                        onActivo={(id, activo) => void patchConcepto(id, { activo })}
                        onCopiarAnterior={() => void onCopiarAnterior()}
                      />
                    </fieldset>
                  </>
                )}

                {abierto === "facturacion" && (
                  <>
                    <AyudaDato
                      que={
                        <>
                          Todo lo facturado en {mes} con prefijo F93 y F94, menos sus notas crédito. Con
                          este <Termino t="neto">neto</Termino> se calcula qué parte de las comisiones del
                          mes va al gasto cada mes.
                        </>
                      }
                      donde={<>En NetSuite: las facturas y notas crédito F93 y F94 emitidas en el mes.</>}
                    />
                    <fieldset disabled={soloLectura} className="contents">
                      <BasePanel base={baseMes} onChange={(p, c, v) => void onBase(p, c, v)} />
                    </fieldset>
                  </>
                )}

                {abierto === "informe" && (
                  <>
                    <AyudaDato
                      que={
                        <>
                          El Excel mensual con el ingreso reconocido de cada factura. Dice cuánto
                          ingreso de cada mes de facturas se reconoció en {mes}.
                        </>
                      }
                      donde={
                        <>
                          Llega a inicios del mes siguiente. Pesa mucho: se lee en tu navegador y no
                          se sube a ningún servidor.
                        </>
                      }
                    />
                    <InformePanel lectura={lectura} guardado={guardado} onArchivo={cargar} onQuitar={limpiar} />
                  </>
                )}

                {faltante && faltante !== abierto && listo[abierto] && (
                  <div className="flex justify-end border-t border-border pt-3">
                    <Button size="sm" onClick={() => abrir(faltante)}>
                      Siguiente: {DATO_CORTO[faltante]}
                      <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>

          <section aria-labelledby="resultado-seccion" className="flex flex-col gap-3">
            <h2 id="resultado-seccion" className="text-sm font-semibold">
              Resultado de {mes}
            </h2>

            {cierre ? (
              <>
                <ResultadoCard
                  cierre={cierre}
                  controles={controles}
                  tareas={tareas}
                  fuente={archivo ? "informe" : "registrado"}
                  guardadoEn={guardado?.createdAt ?? null}
                  sinGuardar={sinGuardar}
                  puedeGuardar={!soloLectura && !!archivo}
                  guardando={guardando}
                  exportando={exportando}
                  onGuardar={() => void onGuardar()}
                  onExportar={() => void onExportar()}
                  onTarea={onTarea}
                />

                <div id="detalle-mes" data-tour="detalle" className="scroll-mt-20 rounded-lg border border-border bg-card shadow-sm">
                  <button
                    type="button"
                    aria-expanded={detalleAbierto}
                    aria-controls="detalle-cuerpo"
                    onClick={() => setDetalleAbierto((v) => !v)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-5 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold">Ver detalle</span>
                      <span className="text-xs text-muted-foreground">
                        Cálculo por cohorte, {cierre.asientos.length} asientos para NetSuite, controles
                        {archivo ? " y comprobantes" : ""}
                      </span>
                    </span>
                    <ChevronDown
                      aria-hidden
                      className={cn("size-4 shrink-0 text-muted-foreground transition-transform", detalleAbierto && "rotate-180")}
                    />
                  </button>
                  {detalleAbierto && (
                    <div id="detalle-cuerpo" className="border-t border-border px-5 pb-5 pt-4">
                      <RevisionPanel
                        cierre={cierre}
                        controles={controles}
                        vista={vista}
                        onVista={setVista}
                        comprobantes={
                          archivo ? <DocumentosTable documentos={archivo.documentos} periodo={periodo} /> : undefined
                        }
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-5 py-6">
                <p className="text-sm">
                  El gasto del mes aparece cuando cargues el informe diferido de {mes}.
                </p>
                <p className="text-sm text-muted-foreground">
                  {faltante
                    ? `Falta: ${DATOS.filter((d) => !listo[d]).map((d) => DATO_CORTO[d]).join(", ")}.`
                    : "Ya están los datos del mes."}
                </p>
                {faltante && (
                  <Button size="sm" variant="outline" onClick={() => { abrir(faltante); irA("datos-mes"); }}>
                    Completar {DATO_CORTO[faltante]}
                  </Button>
                )}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value="seguimiento" className="pt-4">
          <SeguimientoTab
            datos={datos}
            cierres={cierres}
            onAbrir={(p) => {
              setPeriodo(p);
              setTab("cierre");
            }}
            onEliminar={soloLectura ? undefined : onEliminar}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const DATOS: DatoMes[] = ["comisiones", "facturacion", "informe"];

const DATO_CORTO: Record<DatoMes, string> = {
  comisiones: "comisiones del mes",
  facturacion: "facturación F93/F94",
  informe: "informe diferido",
};

const EDITOR_TITULO: Record<DatoMes, (mes: string) => string> = {
  comisiones: (mes) => `Comisiones causadas en ${mes}`,
  facturacion: (mes) => `Facturación F93/F94 de ${mes}`,
  informe: (mes) => `Informe diferido de ${mes}`,
};

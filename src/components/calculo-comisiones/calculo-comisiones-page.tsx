"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, Download, Loader2, Save, Upload } from "lucide-react";
import { toast } from "sonner";

import { ComoUsar } from "@/components/tour/como-usar";
import { Button } from "@/components/ui/button";
import { SoloLectura } from "@/components/common/solo-lectura";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { formatCentavos, formatNumber, formatPesos } from "./format";
import { Paso, ResumenPaso, type EstadoPaso } from "./paso";
import { PeriodoPicker } from "./periodo-picker";
import { RevisionPanel } from "./revision-panel";
import { InformePanel } from "./informe-panel";
import { SeguimientoTab } from "./seguimiento-tab";
import { SiguienteBand, type SenalSiguiente } from "./siguiente-band";
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

  // --- Pasos del cierre ----------------------------------------------------

  const mes = periodoLabel(periodo).toLowerCase();
  const netoMes = baseMes.F94.facturas - baseMes.F94.notasCredito + baseMes.F93.facturas - baseMes.F93.notasCredito;
  const leyendo = lectura.estado === "leyendo";
  const listo = [
    pool !== 0,
    netoMes > 0,
    !!archivo || tieneRegistro,
    !!cierre && ((!!guardado && !sinGuardar) || (!archivo && tieneRegistro)),
  ];
  const actual = listo.findIndex((x) => !x);
  const estadoDe = (i: number): EstadoPaso =>
    listo[i] ? "hecho" : i === actual ? "actual" : "pendiente";

  // Abierto: el paso actual y la revisión cuando hay cálculo; el resto a pedido.
  const [abiertos, setAbiertos] = useState<Record<number, boolean>>({});
  useEffect(() => setAbiertos({}), [periodo]);
  const estaAbierto = (i: number) => abiertos[i] ?? (i === actual || (i === 3 && !!cierre));
  const toggle = (i: number) => setAbiertos((a) => ({ ...a, [i]: !estaAbierto(i) }));

  const irA = (i: number) => {
    setAbiertos((a) => ({ ...a, [i]: true }));
    requestAnimationFrame(() =>
      document.getElementById(`paso-${i + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const irBoton = (i: number, texto = "Ir al paso") => (
    <Button size="sm" variant="secondary" onClick={() => irA(i)}>
      <ArrowDown className="size-3.5" />
      {texto}
    </Button>
  );

  const errores = controles.filter((c) => c.estado === "error");
  let senal: SenalSiguiente;
  if (leyendo) {
    senal = {
      tipo: "trabajando",
      mensaje: `Leyendo el informe diferido de ${mes}`,
      detalle: "El archivo se procesa en tu navegador; puedes seguir revisando los otros pasos.",
    };
  } else if (actual === 0) {
    senal = {
      tipo: "siguiente",
      mensaje: `Registra las comisiones causadas en ${mes}`,
      detalle: "Valor por concepto, con su cuenta de gasto. Son la cohorte del mes.",
      accion: irBoton(0),
    };
  } else if (actual === 1) {
    senal = {
      tipo: "siguiente",
      mensaje: `Ingresa la facturación F93/F94 de ${mes}`,
      detalle: "Facturas y notas crédito emitidas según NetSuite. El neto es la base del % de esta cohorte.",
      accion: irBoton(1),
    };
  } else if (actual === 2) {
    senal = {
      tipo: "siguiente",
      mensaje: `Carga el informe diferido de ${mes}`,
      detalle: "Arrástralo a cualquier parte de la página. Da el ingreso del mes de cada cohorte.",
      accion: irBoton(2),
    };
  } else if (actual === 3 && errores.length > 0) {
    senal = {
      tipo: "siguiente",
      mensaje: `Resuelve ${errores.length === 1 ? "1 control en error" : `${errores.length} controles en error`} antes de guardar`,
      detalle: errores.map((e) => e.titulo).join(" · "),
      accion: irBoton(3, "Ver controles"),
    };
  } else if (actual === 3 && cierre) {
    senal = {
      tipo: "siguiente",
      mensaje: "Revisa el cálculo y guarda el cierre",
      detalle: `Gasto del mes ${formatCentavos(cierre.gastoMes)} · ${cierre.asientos.length} asientos cuadrados`,
      accion: (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => void onExportar()} disabled={exportando}>
            {exportando ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            Exportar Excel
          </Button>
          <Button size="sm" onClick={() => void onGuardar()} disabled={soloLectura || guardando || !sinGuardar}>
            {guardando ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Guardar cierre
          </Button>
        </div>
      ),
    };
  } else {
    senal = {
      tipo: "listo",
      mensaje: guardado
        ? `Cierre de ${mes} guardado`
        : `${periodoLabel(periodo)} está registrado desde el Excel de contabilidad`,
      detalle: cierre
        ? `Exporta el Excel para registrar los ${cierre.asientos.length} asientos en NetSuite.`
        : "Sin cálculo para este mes.",
      accion: cierre ? (
        <Button size="sm" variant="secondary" onClick={() => void onExportar()} disabled={exportando}>
          {exportando ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          Exportar Excel
        </Button>
      ) : undefined,
    };
  }

  const TITULOS = ["Comisiones causadas", "Facturación del mes", "Informe diferido", "Revisión y asientos"];

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
            <p className="max-w-2xl text-sm text-muted-foreground">
              Las comisiones de cada mes se llevan al gasto al mismo ritmo en que se
              reconoce el ingreso de las facturas F93 y F94 emitidas ese mes.
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

        <TabsContent value="cierre" className="flex flex-col gap-3">
          <SiguienteBand
            senal={senal}
            pasoActual={actual === -1 ? null : actual + 1}
            pasos={TITULOS.map((titulo, i) => ({ titulo, hecho: listo[i]!, actual: i === actual }))}
          />

          <Paso
            n={1}
            titulo={TITULOS[0]!}
            tipo="gasto"
            estado={estadoDe(0)}
            descripcion={`Comisiones del mes por concepto, con su cuenta de gasto`}
            resumen={
              pool !== 0 ? (
                <ResumenPaso valor={formatPesos(pool)} detalle={`${valoresPeriodo.size} conceptos`} />
              ) : undefined
            }
            abierto={estaAbierto(0)}
            onToggle={() => toggle(0)}
          >
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
          </Paso>

          <Paso
            n={2}
            titulo={TITULOS[1]!}
            tipo="ingreso"
            estado={estadoDe(1)}
            descripcion="Facturas y notas crédito F93/F94 emitidas en el mes, según NetSuite"
            resumen={
              netoMes !== 0 ? <ResumenPaso valor={formatPesos(netoMes)} detalle="Neto F93 + F94" /> : undefined
            }
            abierto={estaAbierto(1)}
            onToggle={() => toggle(1)}
          >
            <fieldset disabled={soloLectura} className="contents">
              <BasePanel base={baseMes} onChange={(p, c, v) => void onBase(p, c, v)} />
            </fieldset>
          </Paso>

          <Paso
            n={3}
            titulo={TITULOS[2]!}
            tipo="ingreso"
            estado={leyendo ? "actual" : estadoDe(2)}
            descripcion="Excel mensual: el ingreso F93/F94 reconocido en el mes, por cohorte"
            resumen={
              archivo ? (
                <ResumenPaso
                  texto
                  valor={archivo.archivoNombre}
                  detalle={`${formatNumber(archivo.documentos.length)} comprobantes`}
                />
              ) : tieneRegistro ? (
                <ResumenPaso
                  texto
                  valor="Ingreso registrado"
                  detalle={guardado ? "Cierre guardado" : "Excel de contabilidad"}
                />
              ) : undefined
            }
            abierto={estaAbierto(2) || leyendo}
            onToggle={() => toggle(2)}
          >
            <InformePanel lectura={lectura} guardado={guardado} onArchivo={leer} onQuitar={limpiar} />
          </Paso>

          <Paso
            n={4}
            titulo={TITULOS[3]!}
            estado={estadoDe(3)}
            descripcion="Gasto por cohorte, asientos para NetSuite y controles"
            resumen={
              cierre ? (
                <ResumenPaso valor={formatCentavos(cierre.gastoMes)} detalle="Gasto del mes" />
              ) : undefined
            }
            abierto={estaAbierto(3)}
            onToggle={() => toggle(3)}
          >
            {cierre ? (
              <RevisionPanel
                cierre={cierre}
                controles={controles}
                fuente={archivo ? "informe" : "registrado"}
                guardadoEn={guardado?.createdAt ?? null}
                sinGuardar={sinGuardar}
                puedeGuardar={!soloLectura && !!archivo}
                comprobantes={
                  archivo ? <DocumentosTable documentos={archivo.documentos} periodo={periodo} /> : undefined
                }
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                El cálculo aparece cuando el informe diferido de {mes} esté cargado.
              </p>
            )}
          </Paso>
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

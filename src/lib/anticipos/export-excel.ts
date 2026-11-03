import type ExcelJS from "exceljs";

import {
  ANTICIPOS_FALTA_LABELS,
  ANTICIPOS_OBSERVACION_1_LABELS,
  todayIsoDate,
  type AnticipoFalta,
  type AnticipoObservacion1,
  type AnticipoRow,
} from "@/lib/anticipos/schema";
import { DIAS_ATRASO, NIVEL_SEGUIMIENTO_LABEL, seguimientoDe as seguimientoBase } from "@/lib/anticipos/seguimiento";

/**
 * Reporte .xlsx de Gestión y Legalización de Anticipos, generado en el
 * navegador con las filas que muestra la tabla (filtros y orden incluidos).
 * Hoja "Resumen" con los indicadores de la página y el desglose por falta y
 * observación; hoja "Detalle" con un registro por fila.
 */

export interface AnticiposExportFiltros {
  busqueda: string;
  falta: string;
  observacion1: string;
  /** Nivel del semáforo (`revisar`, `atencion`, `ok`) o `pendiente`. */
  seguimiento: string;
  /** `activos` | `excolaboradores`. */
  colaborador: string;
}

const MATCH_LABELS: Record<NonNullable<AnticipoRow["retiro_info"]>["nivel"], string> = {
  exacto: "Exacta",
  exacto_inverso: "Exacta (orden invertido)",
  parcial: "Parcial",
};

// Paleta de la app (sky como primario, tonos de los badges de la tabla).
const C = {
  titulo: "FF0F172A",
  primario: "FF0284C7",
  primarioSuave: "FFE0F2FE",
  texto: "FF0F172A",
  tenue: "FF64748B",
  borde: "FFE2E8F0",
  cebra: "FFF8FAFC",
  blanco: "FFFFFFFF",
} as const;

interface Tono {
  fill: string;
  font: string;
}

const TONOS = {
  exito: { fill: "FFECFDF5", font: "FF047857" },
  alerta: { fill: "FFFFFBEB", font: "FFB45309" },
  info: { fill: "FFF0F9FF", font: "FF0369A1" },
  peligro: { fill: "FFFFF1F2", font: "FFBE123C" },
  neutro: { fill: "FFF1F5F9", font: "FF334155" },
} satisfies Record<string, Tono>;

function tonoFalta(value: AnticipoFalta): Tono {
  if (value === "legalizado") return TONOS.exito;
  if (value === "devolucion") return TONOS.alerta;
  if (
    value === "revisar_con_harold" ||
    value === "revisar_soportes" ||
    value === "revisar_descuento_nomina"
  ) {
    return TONOS.info;
  }
  return TONOS.neutro;
}

function tonoObservacion(value: AnticipoObservacion1): Tono {
  if (value === "legalizado") return TONOS.exito;
  if (value === "correo_al_lider") return TONOS.info;
  if (value === "escrito_3_veces") return TONOS.alerta;
  return TONOS.neutro;
}

type Seguimiento = "Resuelto" | "Atrasado" | "En plazo";

const TONO_SEGUIMIENTO: Record<Seguimiento, Tono> = {
  Resuelto: TONOS.exito,
  Atrasado: TONOS.peligro,
  "En plazo": TONOS.neutro,
};

function seguimientoDe(r: AnticipoRow, hoy: string): { estado: Seguimiento; dias: number | null } {
  const s = seguimientoBase(r, hoy);
  return { estado: NIVEL_SEGUIMIENTO_LABEL[s.nivel] as Seguimiento, dias: s.dias };
}

/** Fecha ISO como `Date` UTC: exceljs la escribe sin corrimiento de zona. */
function isoADate(iso: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

const BORDE_FINO: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: C.borde } },
  bottom: { style: "thin", color: { argb: C.borde } },
  left: { style: "thin", color: { argb: C.borde } },
  right: { style: "thin", color: { argb: C.borde } },
};

const FMT_FECHA = "dd/mm/yyyy";
const FMT_MONEDA = '"$" #,##0';
const FMT_ENTERO = "#,##0";
const FMT_PCT = "0%";

function describirFiltros(f: AnticiposExportFiltros): string {
  const partes: string[] = [];
  if (f.busqueda.trim()) partes.push(`Búsqueda «${f.busqueda.trim()}»`);
  if (f.falta) partes.push(`Falta: ${ANTICIPOS_FALTA_LABELS[f.falta as AnticipoFalta] ?? f.falta}`);
  if (f.observacion1) {
    partes.push(
      `Observación 1: ${ANTICIPOS_OBSERVACION_1_LABELS[f.observacion1 as AnticipoObservacion1] ?? f.observacion1}`,
    );
  }
  if (f.seguimiento) {
    const nivel = f.seguimiento as keyof typeof NIVEL_SEGUIMIENTO_LABEL;
    partes.push(`Seguimiento: ${f.seguimiento === "pendiente" ? "Sin resolver" : (NIVEL_SEGUIMIENTO_LABEL[nivel] ?? f.seguimiento)}`);
  }
  if (f.colaborador === "excolaboradores") partes.push("Solo excolaboradores");
  if (f.colaborador === "activos") partes.push("Solo colaboradores activos");
  return partes.length === 0 ? "Sin filtros" : partes.join(" · ");
}

function fechaHoraGeneracion(): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());
}

/** Título y subtítulo en las dos primeras filas, fusionados en `columnas`. */
function encabezado(hoja: ExcelJS.Worksheet, columnas: number, titulo: string, subtitulo: string) {
  hoja.mergeCells(1, 1, 1, columnas);
  const t = hoja.getCell(1, 1);
  t.value = titulo;
  t.font = { name: "Calibri", size: 16, bold: true, color: { argb: C.blanco } };
  t.fill = fill(C.titulo);
  t.alignment = { vertical: "middle", indent: 1 };
  hoja.getRow(1).height = 34;

  hoja.mergeCells(2, 1, 2, columnas);
  const s = hoja.getCell(2, 1);
  s.value = subtitulo;
  s.font = { size: 10, italic: true, color: { argb: C.tenue } };
  s.fill = fill(C.primarioSuave);
  s.alignment = { vertical: "middle", indent: 1, wrapText: true };
  hoja.getRow(2).height = 22;
}

function estiloCabecera(row: ExcelJS.Row) {
  row.height = 26;
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: C.blanco } };
    cell.fill = fill(C.primario);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = BORDE_FINO;
  });
}

function pintarTono(cell: ExcelJS.Cell, tono: Tono) {
  cell.fill = fill(tono.fill);
  cell.font = { ...cell.font, bold: true, color: { argb: tono.font } };
}

function escribirResumen(
  wb: ExcelJS.Workbook,
  rows: AnticipoRow[],
  subtitulo: string,
  hoy: string,
) {
  const hoja = wb.addWorksheet("Resumen", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: C.primario } },
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  hoja.columns = [{ width: 3 }, { width: 38 }, { width: 16 }, { width: 14 }];
  encabezado(hoja, 4, "Gestión y Legalización de Anticipos", subtitulo);

  const total = rows.length;
  const legalizados = rows.filter((r) => r.falta === "legalizado").length;
  const pendientes = total - legalizados;
  const devoluciones = rows.filter((r) => r.falta === "devolucion").length;
  const atrasados = rows.filter((r) => seguimientoDe(r, hoy).estado === "Atrasado").length;
  const retirados = rows.filter((r) => r.es_retirado);
  const valorPendienteRetirados = retirados
    .filter((r) => r.falta !== "legalizado")
    .reduce((acc, r) => acc + (r.retiro_info?.valor ?? 0), 0);

  const valorTotal = rows.reduce((acc, r) => acc + (r.valor ?? 0), 0);
  const valorPendiente = rows
    .filter((r) => r.falta !== "legalizado")
    .reduce((acc, r) => acc + (r.valor ?? 0), 0);

  const pct = (n: number) => (total === 0 ? 0 : n / total);

  let fila = 4;
  const seccion = (titulo: string, columnas: [string, string, string]) => {
    hoja.mergeCells(fila, 2, fila, 4);
    const c = hoja.getCell(fila, 2);
    c.value = titulo;
    c.font = { bold: true, size: 12, color: { argb: C.texto } };
    c.border = { bottom: { style: "medium", color: { argb: C.primario } } };
    hoja.getRow(fila).height = 22;
    fila++;
    const cab = hoja.getRow(fila);
    cab.getCell(2).value = columnas[0];
    cab.getCell(3).value = columnas[1];
    cab.getCell(4).value = columnas[2];
    estiloCabecera(cab);
    cab.getCell(2).alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    fila++;
  };

  const linea = (
    etiqueta: string,
    valor: number,
    opts: { fmt?: string; porcentaje?: number | null; tono?: Tono } = {},
  ) => {
    const row = hoja.getRow(fila);
    const zebra = fila % 2 === 0 ? C.cebra : C.blanco;
    const a = row.getCell(2);
    const b = row.getCell(3);
    const p = row.getCell(4);
    a.value = etiqueta;
    a.alignment = { vertical: "middle", indent: 1 };
    b.value = valor;
    b.numFmt = opts.fmt ?? FMT_ENTERO;
    b.font = { bold: true, color: { argb: C.texto } };
    b.alignment = { vertical: "middle", horizontal: "right" };
    p.value = opts.porcentaje ?? null;
    p.numFmt = FMT_PCT;
    p.font = { color: { argb: C.tenue } };
    p.alignment = { vertical: "middle", horizontal: "right" };
    for (const cell of [a, b, p]) {
      cell.fill = fill(zebra);
      cell.border = BORDE_FINO;
    }
    if (opts.tono) pintarTono(a, opts.tono);
    row.height = 20;
    fila++;
  };

  seccion("Indicadores", ["Indicador", "Valor", "% del total"]);
  linea("Total registros", total);
  linea("Pendientes", pendientes, { porcentaje: pct(pendientes), tono: TONOS.alerta });
  linea("Devoluciones", devoluciones, { porcentaje: pct(devoluciones), tono: TONOS.peligro });
  linea("Legalizados", legalizados, { porcentaje: pct(legalizados), tono: TONOS.exito });
  linea(`Atrasados (≥ ${DIAS_ATRASO} días sin gestión)`, atrasados, {
    porcentaje: pct(atrasados),
    tono: TONOS.peligro,
  });
  linea("Excolaboradores", retirados.length, { porcentaje: pct(retirados.length), tono: TONOS.neutro });
  linea("Valor total de anticipos", valorTotal, { fmt: FMT_MONEDA });
  linea("Valor pendiente por legalizar", valorPendiente, { fmt: FMT_MONEDA });
  linea("Valor pendiente de excolaboradores", valorPendienteRetirados, { fmt: FMT_MONEDA });

  fila++;
  seccion("Por falta", ["Falta", "Registros", "% del total"]);
  for (const [value, label] of Object.entries(ANTICIPOS_FALTA_LABELS) as [AnticipoFalta, string][]) {
    const n = rows.filter((r) => r.falta === value).length;
    if (n === 0) continue;
    linea(label, n, { porcentaje: pct(n), tono: tonoFalta(value) });
  }

  fila++;
  seccion("Por observación 1", ["Observación 1", "Registros", "% del total"]);
  for (const [value, label] of Object.entries(ANTICIPOS_OBSERVACION_1_LABELS) as [
    AnticipoObservacion1,
    string,
  ][]) {
    const n = rows.filter((r) => r.observacion_1 === value).length;
    if (n === 0) continue;
    linea(label, n, { porcentaje: pct(n), tono: tonoObservacion(value) });
  }
}

interface ColumnaDetalle {
  header: string;
  width: number;
  fmt?: string;
  align?: ExcelJS.Alignment["horizontal"];
  wrap?: boolean;
}

const COLUMNAS_DETALLE: ColumnaDetalle[] = [
  { header: "#", width: 6, align: "center" },
  { header: "Colaborador", width: 34 },
  { header: "Requerimiento", width: 18 },
  { header: "Valor anticipo", width: 16, fmt: FMT_MONEDA, align: "right" },
  { header: "Falta", width: 28, align: "center" },
  { header: "Observación 1", width: 20, align: "center" },
  { header: "Observación 2", width: 42, wrap: true },
  { header: "Fecha RQ", width: 12, fmt: FMT_FECHA, align: "center" },
  { header: "Fecha gestión", width: 13, fmt: FMT_FECHA, align: "center" },
  { header: "Seguimiento", width: 13, align: "center" },
  { header: "Días sin gestión", width: 11, fmt: FMT_ENTERO, align: "center" },
  { header: "Excolaborador", width: 13, align: "center" },
  { header: "Cédula", width: 14, fmt: FMT_ENTERO, align: "right" },
  { header: "Valor reportado (Contab.)", width: 16, fmt: FMT_MONEDA, align: "right" },
  { header: "Coincidencia", width: 22, align: "center" },
  { header: "Obs. Contabilidad", width: 40, wrap: true },
];

const COL = {
  valor: 4,
  falta: 5,
  observacion1: 6,
  seguimiento: 10,
  dias: 11,
  excolaborador: 12,
  valorRetiro: 14,
} as const;

function escribirDetalle(wb: ExcelJS.Workbook, rows: AnticipoRow[], subtitulo: string, hoy: string) {
  const ncols = COLUMNAS_DETALLE.length;
  const filaCabecera = 4;
  const hoja = wb.addWorksheet("Detalle", {
    views: [{ state: "frozen", ySplit: filaCabecera, xSplit: 2, showGridLines: false }],
    pageSetup: {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: `${filaCabecera}:${filaCabecera}`,
    },
  });
  hoja.columns = COLUMNAS_DETALLE.map((c) => ({ width: c.width }));
  encabezado(hoja, ncols, "Detalle de anticipos", subtitulo);

  const cab = hoja.getRow(filaCabecera);
  COLUMNAS_DETALLE.forEach((c, i) => {
    cab.getCell(i + 1).value = c.header;
  });
  estiloCabecera(cab);

  rows.forEach((r, i) => {
    const seg = seguimientoDe(r, hoy);
    const retiro = r.retiro_info;
    const row = hoja.getRow(filaCabecera + 1 + i);
    row.values = [
      i + 1,
      r.nombre,
      r.requerimiento,
      r.valor,
      ANTICIPOS_FALTA_LABELS[r.falta],
      ANTICIPOS_OBSERVACION_1_LABELS[r.observacion_1],
      r.observacion_2 ?? "",
      isoADate(r.fecha_rq),
      isoADate(r.fecha_gestion),
      seg.estado,
      seg.dias,
      r.es_retirado ? "Sí" : "No",
      retiro?.cedula ?? null,
      retiro?.valor ?? null,
      retiro ? MATCH_LABELS[retiro.nivel] : "",
      retiro?.observacion ?? "",
    ];

    const zebra = i % 2 === 0 ? C.blanco : C.cebra;
    COLUMNAS_DETALLE.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      cell.fill = fill(zebra);
      cell.border = BORDE_FINO;
      cell.font = { size: 10, color: { argb: r.es_retirado ? C.tenue : C.texto } };
      cell.alignment = { vertical: "middle", horizontal: c.align, wrapText: c.wrap };
      if (c.fmt) cell.numFmt = c.fmt;
    });
    row.getCell(1).font = { size: 9, color: { argb: C.tenue } };
    row.getCell(2).font = { size: 10, bold: true, color: { argb: r.es_retirado ? C.tenue : C.texto } };

    pintarTono(row.getCell(COL.falta), tonoFalta(r.falta));
    pintarTono(row.getCell(COL.observacion1), tonoObservacion(r.observacion_1));
    pintarTono(row.getCell(COL.seguimiento), TONO_SEGUIMIENTO[seg.estado]);
    if (seg.estado === "Atrasado") {
      row.getCell(COL.dias).font = { size: 10, bold: true, color: { argb: TONOS.peligro.font } };
    }
    if (r.es_retirado) pintarTono(row.getCell(COL.excolaborador), TONOS.neutro);
  });

  const primera = filaCabecera + 1;
  const ultima = filaCabecera + rows.length;

  // Totales que respetan el autofiltro de Excel (SUBTOTAL ignora filas ocultas).
  if (rows.length > 0) {
    const totalRow = hoja.getRow(ultima + 1);
    hoja.mergeCells(ultima + 1, 1, ultima + 1, COL.valor - 1);
    const etiqueta = totalRow.getCell(1);
    etiqueta.value = "Total (filas visibles)";
    etiqueta.alignment = { vertical: "middle", horizontal: "right", indent: 1 };
    const subtotal = (col: number, result: number) => {
      const letra = hoja.getColumn(col).letter;
      const cell = totalRow.getCell(col);
      cell.value = {
        formula: `SUBTOTAL(109,${letra}${primera}:${letra}${ultima})`,
        result,
      };
      cell.numFmt = FMT_MONEDA;
      cell.alignment = { vertical: "middle", horizontal: "right" };
    };
    subtotal(COL.valor, rows.reduce((acc, r) => acc + (r.valor ?? 0), 0));
    subtotal(COL.valorRetiro, rows.reduce((acc, r) => acc + (r.retiro_info?.valor ?? 0), 0));
    for (let j = 1; j <= ncols; j++) {
      const cell = totalRow.getCell(j);
      cell.fill = fill(C.primarioSuave);
      cell.font = { bold: true, size: 10, color: { argb: C.texto } };
      cell.border = { top: { style: "medium", color: { argb: C.primario } } };
    }
    totalRow.height = 22;
  }

  hoja.autoFilter = {
    from: { row: filaCabecera, column: 1 },
    to: { row: Math.max(ultima, filaCabecera), column: ncols },
  };
}

function descargar(buffer: ArrayBuffer, fileName: string) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function descargarAnticiposExcel(params: {
  rows: AnticipoRow[];
  totalRegistros: number;
  /** `YYYY-MM-DD` en hora de Colombia, el mismo del semáforo de la página. */
  hoy?: string;
  filtros: AnticiposExportFiltros;
}): Promise<void> {
  const { rows, totalRegistros, filtros, hoy = todayIsoDate() } = params;
  const { default: ExcelJSLib } = await import("exceljs");

  const wb = new ExcelJSLib.Workbook();
  wb.creator = "Toolbox";
  wb.created = new Date();
  wb.title = "Gestión y Legalización de Anticipos";

  const registros =
    rows.length === totalRegistros
      ? `${rows.length} registros`
      : `${rows.length} de ${totalRegistros} registros`;
  const subtitulo = `Generado el ${fechaHoraGeneracion()} · ${registros} · ${describirFiltros(filtros)}`;

  escribirResumen(wb, rows, subtitulo, hoy);
  escribirDetalle(wb, rows, subtitulo, hoy);

  const buffer = await wb.xlsx.writeBuffer();
  descargar(buffer as ArrayBuffer, `anticipos_${todayIsoDate()}.xlsx`);
}

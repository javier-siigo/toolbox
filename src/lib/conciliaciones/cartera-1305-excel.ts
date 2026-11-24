import type ExcelJS from "exceljs";

import { tipoLabel, type ResumenCartera, type TerceroNegativo } from "./cartera-1305-shared";

/**
 * Excel de la Conciliación 1305, generado en el navegador con lo que muestra la página:
 * "Resumen" (parámetros, indicadores, cartera por tipo), "Terceros negativos" (un tercero
 * por fila con su saldo) y "Documentos" (equivalente a la hoja 1305 Negative DOC).
 */

const C = {
  titulo: "FF0F172A",
  primario: "FF0284C7",
  primarioSuave: "FFE0F2FE",
  texto: "FF0F172A",
  tenue: "FF64748B",
  borde: "FFE2E8F0",
  cebra: "FFF8FAFC",
  blanco: "FFFFFFFF",
  negativo: "FFBE123C",
  negativoSuave: "FFFFF1F2",
} as const;

const FMT_FECHA = "dd/mm/yyyy";
const FMT_MONEDA = '"$" #,##0.00;[Red]-"$" #,##0.00';
const FMT_ENTERO = "#,##0";

const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

const BORDE: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: C.borde } },
  bottom: { style: "thin", color: { argb: C.borde } },
  left: { style: "thin", color: { argb: C.borde } },
  right: { style: "thin", color: { argb: C.borde } },
};

function isoADate(iso: string | null): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
}

function fechaLarga(iso: string): string {
  const d = isoADate(iso);
  return d ? new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "UTC" }).format(d) : iso;
}

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

function cabecera(row: ExcelJS.Row) {
  row.height = 26;
  row.eachCell((cell) => {
    cell.font = { bold: true, size: 10, color: { argb: C.blanco } };
    cell.fill = fill(C.primario);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = BORDE;
  });
}

function filaTotal(row: ExcelJS.Row, ncols: number) {
  for (let j = 1; j <= ncols; j++) {
    const cell = row.getCell(j);
    cell.fill = fill(C.primarioSuave);
    cell.font = { bold: true, size: 10, color: { argb: C.texto } };
    cell.border = { top: { style: "medium", color: { argb: C.primario } } };
  }
  row.height = 22;
}

function cuerpo(row: ExcelJS.Row, i: number, ncols: number) {
  for (let j = 1; j <= ncols; j++) {
    const cell = row.getCell(j);
    cell.border = BORDE;
    cell.font = { size: 10, color: { argb: C.texto } };
    if (i % 2 === 1) cell.fill = fill(C.cebra);
  }
}

export interface Parametros1305 {
  subsidiaria: string;
  corte: string;
  generado: Date;
}

function escribirResumen(
  wb: ExcelJS.Workbook,
  p: Parametros1305,
  resumen: ResumenCartera,
  negativos: TerceroNegativo[],
  subtitulo: string,
) {
  const hoja = wb.addWorksheet("Resumen", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: C.primario } },
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  hoja.columns = [{ width: 3 }, { width: 40 }, { width: 22 }, { width: 14 }];
  encabezado(hoja, 4, "Conciliación 1305 · Cartera con saldo negativo", subtitulo);

  let fila = 4;
  const seccion = (titulo: string) => {
    const c = hoja.getCell(fila, 2);
    c.value = titulo;
    c.font = { bold: true, size: 11, color: { argb: C.primario } };
    hoja.getRow(fila).height = 20;
    fila++;
  };
  const dato = (etiqueta: string, valor: ExcelJS.CellValue, fmt?: string, destacar = false) => {
    const e = hoja.getCell(fila, 2);
    e.value = etiqueta;
    e.font = { size: 10, color: { argb: C.tenue } };
    e.border = BORDE;
    const v = hoja.getCell(fila, 3);
    v.value = valor;
    v.font = { size: 10, bold: true, color: { argb: destacar ? C.negativo : C.texto } };
    v.border = BORDE;
    v.alignment = { horizontal: "right" };
    if (fmt) v.numFmt = fmt;
    if (destacar) v.fill = fill(C.negativoSuave);
    fila++;
  };

  const totalNeg = negativos.reduce((a, t) => a + t.saldo, 0);
  const totalDocs = negativos.reduce((a, t) => a + t.lineas.reduce((b, l) => b + l.saldo, 0), 0);
  const docs = negativos.reduce((a, t) => a + t.lineas.length, 0);

  seccion("Parámetros");
  dato("Subsidiaria", p.subsidiaria);
  dato("Fecha de corte", isoADate(p.corte), FMT_FECHA);
  dato("Cuentas", "1305 (cuentas de movimiento por cobrar)");
  fila++;
  seccion("Resultado");
  dato("Terceros con saldo negativo", negativos.length, FMT_ENTERO);
  dato("Saldo negativo de esos terceros", totalNeg, FMT_MONEDA, true);
  dato("Documentos listados (sin facturas de venta)", docs, FMT_ENTERO);
  dato("Suma de los documentos listados", totalDocs, FMT_MONEDA, true);
  fila++;
  seccion("Cartera al corte");
  dato("Saldo total de la cartera 1305", resumen.carteraTotal, FMT_MONEDA);
  dato("Partidas abiertas", resumen.partidas, FMT_ENTERO);
  dato("Terceros con partidas abiertas", resumen.terceros, FMT_ENTERO);
  fila++;

  const cab = hoja.getRow(fila);
  cab.getCell(2).value = "Tipo de transacción";
  cab.getCell(3).value = "Saldo";
  cab.getCell(4).value = "Partidas";
  cabecera(cab);
  hoja.getCell(fila, 1).fill = fill(C.blanco);
  hoja.getCell(fila, 1).border = {};
  fila++;
  resumen.porTipo.forEach((t, i) => {
    const r = hoja.getRow(fila++);
    r.getCell(2).value = tipoLabel(t.tipo);
    r.getCell(3).value = t.saldo;
    r.getCell(3).numFmt = FMT_MONEDA;
    r.getCell(4).value = t.partidas;
    r.getCell(4).numFmt = FMT_ENTERO;
    for (const j of [2, 3, 4]) {
      r.getCell(j).border = BORDE;
      r.getCell(j).font = { size: 10 };
      if (i % 2 === 1) r.getCell(j).fill = fill(C.cebra);
    }
  });
  fila++;
  const nota = hoja.getCell(fila, 2);
  hoja.mergeCells(fila, 2, fila + 2, 4);
  nota.value =
    "Saldo de cada partida a la fecha de corte: lo pendiente hoy más lo aplicado después del corte. " +
    "Un tercero entra si la suma de sus partidas es negativa; sus facturas de venta suman al saldo pero no se listan en Documentos.";
  nota.font = { size: 9, italic: true, color: { argb: C.tenue } };
  nota.alignment = { wrapText: true, vertical: "top" };
}

function escribirTerceros(wb: ExcelJS.Workbook, negativos: TerceroNegativo[], subtitulo: string) {
  const hoja = wb.addWorksheet("Terceros negativos", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
  const columnas = [
    { titulo: "Cliente", width: 52 },
    { titulo: "KS Documento", width: 18 },
    { titulo: "Saldo del tercero", width: 20 },
    { titulo: "Documentos", width: 12 },
    { titulo: "Suma documentos", width: 20 },
    { titulo: "Facturas abiertas", width: 12 },
    { titulo: "Saldo facturas", width: 18 },
  ];
  hoja.columns = columnas.map((c) => ({ width: c.width }));
  encabezado(hoja, columnas.length, "Terceros con saldo negativo", subtitulo);
  const cab = hoja.getRow(4);
  columnas.forEach((c, j) => (cab.getCell(j + 1).value = c.titulo));
  cabecera(cab);

  let fila = 5;
  negativos.forEach((t, i) => {
    const r = hoja.getRow(fila++);
    const suma = t.lineas.reduce((a, l) => a + l.saldo, 0);
    r.values = [t.tercero.nombre, t.tercero.documento, t.saldo, t.lineas.length, suma, t.facturas, t.facturas ? t.facturasSaldo : null];
    cuerpo(r, i, columnas.length);
    for (const j of [3, 5, 7]) r.getCell(j).numFmt = FMT_MONEDA;
    for (const j of [4, 6]) r.getCell(j).numFmt = FMT_ENTERO;
  });
  const ultima = fila - 1;
  const tot = hoja.getRow(fila);
  tot.getCell(1).value = `Total · ${negativos.length} terceros`;
  for (const j of [3, 4, 5, 6, 7]) {
    const col = String.fromCharCode(64 + j);
    tot.getCell(j).value = { formula: `SUBTOTAL(9,${col}5:${col}${Math.max(ultima, 5)})` };
    tot.getCell(j).numFmt = j === 4 || j === 6 ? FMT_ENTERO : FMT_MONEDA;
  }
  filaTotal(tot, columnas.length);
  hoja.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(ultima, 4), column: columnas.length } };
}

function escribirDocumentos(wb: ExcelJS.Workbook, negativos: TerceroNegativo[], subtitulo: string) {
  const hoja = wb.addWorksheet("Documentos", { views: [{ state: "frozen", ySplit: 4, showGridLines: false }] });
  const columnas = [
    { titulo: "Cliente", width: 46 },
    { titulo: "KS Documento", width: 16 },
    { titulo: "Tipo de transacción", width: 22 },
    { titulo: "Fecha", width: 12 },
    { titulo: "Número de documento", width: 18 },
    { titulo: "Fecha de vencimiento", width: 14 },
    { titulo: "Días vencido", width: 10 },
    { titulo: "Cuenta", width: 12 },
    { titulo: "Saldo pendiente", width: 18 },
  ];
  hoja.columns = columnas.map((c) => ({ width: c.width }));
  encabezado(hoja, columnas.length, "Documentos de los terceros con saldo negativo", subtitulo);
  const cab = hoja.getRow(4);
  columnas.forEach((c, j) => (cab.getCell(j + 1).value = c.titulo));
  cabecera(cab);

  let fila = 5;
  let i = 0;
  for (const t of negativos) {
    for (const l of t.lineas) {
      const r = hoja.getRow(fila++);
      r.values = [
        t.tercero.nombre,
        t.tercero.documento,
        l.tipo,
        isoADate(l.fecha),
        l.numero,
        isoADate(l.vence),
        l.diasVencido,
        l.cuenta,
        l.saldo,
      ];
      cuerpo(r, i++, columnas.length);
      r.getCell(4).numFmt = FMT_FECHA;
      r.getCell(6).numFmt = FMT_FECHA;
      r.getCell(7).numFmt = FMT_ENTERO;
      r.getCell(9).numFmt = FMT_MONEDA;
    }
  }
  const ultima = fila - 1;
  const tot = hoja.getRow(fila);
  tot.getCell(1).value = `Total · ${i} documentos`;
  tot.getCell(9).value = { formula: `SUBTOTAL(9,I5:I${Math.max(ultima, 5)})` };
  tot.getCell(9).numFmt = FMT_MONEDA;
  filaTotal(tot, columnas.length);
  hoja.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(ultima, 4), column: columnas.length } };
}

export async function descargarExcel1305(
  p: Parametros1305,
  resumen: ResumenCartera,
  negativos: TerceroNegativo[],
): Promise<void> {
  const buffer = await construirExcel1305(p, resumen, negativos);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `conciliacion_1305_${p.corte}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** El libro como bytes (separado de la descarga para poder probarlo fuera del navegador). */
export async function construirExcel1305(
  p: Parametros1305,
  resumen: ResumenCartera,
  negativos: TerceroNegativo[],
): Promise<ArrayBuffer> {
  const { default: ExcelJSLib } = await import("exceljs");
  const wb = new ExcelJSLib.Workbook();
  wb.creator = "Toolbox";
  wb.created = p.generado;
  wb.title = "Conciliación 1305";

  const generado = new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeStyle: "short" }).format(p.generado);
  const subtitulo = `${p.subsidiaria} · Corte al ${fechaLarga(p.corte)} · Generado el ${generado} desde NetSuite`;

  escribirResumen(wb, p, resumen, negativos, subtitulo);
  escribirTerceros(wb, negativos, subtitulo);
  escribirDocumentos(wb, negativos, subtitulo);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

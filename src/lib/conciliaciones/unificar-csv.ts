// Unifica varios CSV diarios (p. ej. el export de pagos de Stripe) en un solo CSV que se
// concilia como extracto. Sin n8n: es solo juntar filas con el mismo encabezado.

import type { ArchivoTxtConError } from "./particularidades";

export interface CsvEntrada {
  nombre: string;
  texto: string;
}

export interface CsvUnificado {
  csv: string;
  archivos: number;
  registros: number;
  duplicadosOmitidos: number;
  /** Suma de la columna Amount (si existe). */
  totalNeto: number | null;
  archivosConError: ArchivoTxtConError[];
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Separador del archivo: ";" o ",", el que más aparezca en la primera línea. */
export function detectarSeparador(texto: string): ";" | "," {
  const primera = texto.split(/\r?\n/, 1)[0] ?? "";
  const pc = (primera.match(/;/g) ?? []).length;
  const c = (primera.match(/,/g) ?? []).length;
  return pc >= c ? ";" : ",";
}

/** CSV con comillas ("a;b", "" escapado) a filas; omite filas vacías. */
export function parseCsv(texto: string, sep: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  const cerrarFila = () => {
    fila.push(campo);
    campo = "";
    if (fila.some((v) => v.trim() !== "")) filas.push(fila);
    fila = [];
  };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (comillas) {
      if (ch === '"' && t[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) {
      fila.push(campo);
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      cerrarFila();
    } else campo += ch;
  }
  cerrarFila();
  return filas;
}

function serializar(fila: string[], sep: string): string {
  return fila
    .map((v) => (v.includes(sep) || v.includes('"') || /[\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
    .join(sep);
}

function aNumero(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.replace(/[$\s]/g, "");
  if (t === "") return null;
  const n = Number(/,\d{1,2}$/.test(t) && !t.includes(".") ? t.replace(",", ".") : t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Junta los CSV en uno. Todos deben tener el mismo encabezado (el del primero válido);
 * los que no, quedan en `archivosConError`. Una fila repetida (mismo valor en la columna
 * `id`, o la fila completa si no hay `id`) se cuenta una sola vez.
 */
export function unificarCsv(entradas: CsvEntrada[]): CsvUnificado {
  const archivosConError: ArchivoTxtConError[] = [];
  let sep: ";" | "," | null = null;
  let header: string[] | null = null;
  let claveHeader = "";
  let idCol = -1;
  let amountCol = -1;
  const vistos = new Set<string>();
  const filas: string[][] = [];
  let duplicadosOmitidos = 0;
  let archivos = 0;

  for (const { nombre, texto } of entradas) {
    const sepArchivo = detectarSeparador(texto);
    const [primera, ...resto] = parseCsv(texto, sepArchivo);
    if (!primera) {
      archivosConError.push({ archivo: nombre, error: "El archivo está vacío." });
      continue;
    }
    const enc = primera.map((h) => h.trim());
    const clave = enc.map(normalizar).join("|");
    if (!header) {
      header = enc;
      claveHeader = clave;
      sep = sepArchivo;
      idCol = enc.findIndex((h) => normalizar(h) === "id");
      amountCol = enc.findIndex((h) => normalizar(h) === "amount");
    } else if (clave !== claveHeader) {
      archivosConError.push({
        archivo: nombre,
        error: "Sus columnas no coinciden con las del primer archivo; no se incluyó.",
      });
      continue;
    }
    archivos++;
    for (const fila of resto) {
      const id = idCol > -1 ? (fila[idCol] ?? "").trim() : "";
      const llave = id ? `id:${id}` : `fila:${fila.join("\u0001")}`;
      if (vistos.has(llave)) {
        duplicadosOmitidos++;
        continue;
      }
      vistos.add(llave);
      filas.push(fila);
    }
  }

  if (!header || !sep) {
    return { csv: "", archivos: 0, registros: 0, duplicadosOmitidos: 0, totalNeto: null, archivosConError };
  }

  const total =
    amountCol > -1
      ? Math.round(filas.reduce((s, f) => s + (aNumero(f[amountCol]) ?? 0), 0) * 100) / 100
      : null;
  const csv = [header, ...filas].map((f) => serializar(f, sep)).join("\r\n") + "\r\n";
  return { csv, archivos, registros: filas.length, duplicadosOmitidos, totalNeto: total, archivosConError };
}

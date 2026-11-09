// Particularidades de UI por banco (país + slug de `conciliaciones.bancos`).
// Las URLs de los webhooks viven en el servidor (`convertir-txt.ts`).

export type FormatoConversion = "txt" | "excel";

export interface ConversionConfig {
  /** Formato de los archivos diarios que n8n consolida en un solo Excel. */
  formato: FormatoConversion;
  /** Nombre con el que el Excel consolidado se envía a la conciliación. */
  extractoFilename: string;
}

/** Bancos con una conversión propia (clave `PAIS:slug`). */
const BANCOS_CON_CONVERSION: Record<string, ConversionConfig> = {
  "MX:bananorte-mexico": { formato: "txt", extractoFilename: "banorte_extracto.xlsx" },
};

/**
 * Países donde el resto de bancos entrega reportes diarios en Excel: se pueden
 * unificar varios en uno antes de conciliar.
 */
const PAISES_UNIFICAR_EXCEL = new Set(["MX"]);

export function getConversion(pais: string, slug: string): ConversionConfig | null {
  const propia = BANCOS_CON_CONVERSION[`${pais}:${slug}`];
  if (propia) return propia;
  if (PAISES_UNIFICAR_EXCEL.has(pais)) {
    return { formato: "excel", extractoFilename: `${slug}_extracto.xlsx` };
  }
  return null;
}

export function requiereConversion(pais: string, slug: string): boolean {
  return getConversion(pais, slug) !== null;
}

// Los archivos van directo en el cuerpo de la petición; Vercel corta en 4.5 MB.
export const MAX_TXT_TOTAL_BYTES = 4 * 1024 * 1024;
export const MAX_TXT_TOTAL_LABEL = "4 MB";
export const MAX_TXT_FILES = 31;

const EXTENSIONES: Record<FormatoConversion, readonly string[]> = {
  txt: [".txt"],
  excel: [".xlsx", ".xls"],
};

export const FORMATO_LABEL: Record<FormatoConversion, string> = {
  txt: "TXT",
  excel: "Excel",
};

/** Valor para el `accept` del input de archivos. */
export function acceptDeFormato(formato: FormatoConversion): string {
  return formato === "txt" ? ".txt,text/plain" : EXTENSIONES.excel.join(",");
}

export function esArchivoDeFormato(filename: string, formato: FormatoConversion): boolean {
  const lower = filename.toLowerCase();
  return EXTENSIONES[formato].some((ext) => lower.endsWith(ext));
}

/** Mensaje cuando un archivo no corresponde al formato esperado. */
export function mensajeFormatoInvalido(filename: string, formato: FormatoConversion): string {
  return formato === "txt"
    ? `${filename} no es un archivo .txt.`
    : `${filename} no es un archivo Excel (.xlsx o .xls).`;
}

export interface ArchivoTxtConError {
  archivo: string;
  error: string;
}

/** Lee `[{archivo, error}]` venga como JSON plano o con encodeURIComponent. */
export function parseArchivosConError(raw: unknown): ArchivoTxtConError[] {
  let value = raw;
  if (typeof value === "string") {
    if (value.trim() === "") return [];
    try {
      value = JSON.parse(value.trim().startsWith("[") ? value : decodeURIComponent(value));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null,
    )
    .map((item) => ({
      archivo: String(item.archivo ?? "archivo"),
      error: String(item.error ?? "Error desconocido"),
    }));
}

// Particularidades de UI por banco (país + slug de `conciliacion_bancos`).
// Las URLs de los webhooks viven en el servidor (`convertir-txt.ts`).

interface ConversionTxtConfig {
  /** Nombre con el que el Excel consolidado se envía a la conciliación. */
  extractoFilename: string;
}

/** Bancos cuyo extracto llega como uno o varios .txt que n8n consolida en un Excel. */
const BANCOS_CON_TXT: Record<string, ConversionTxtConfig> = {
  "MX:bananorte-mexico": { extractoFilename: "banorte_extracto.xlsx" },
};

export function getConversionTxt(
  pais: string,
  slug: string,
): ConversionTxtConfig | null {
  return BANCOS_CON_TXT[`${pais}:${slug}`] ?? null;
}

export function requiereConversionTxt(pais: string, slug: string): boolean {
  return getConversionTxt(pais, slug) !== null;
}

// Los TXT van directo en el cuerpo de la petición; Vercel corta en 4.5 MB.
export const MAX_TXT_TOTAL_BYTES = 4 * 1024 * 1024;
export const MAX_TXT_TOTAL_LABEL = "4 MB";
export const MAX_TXT_FILES = 31;

export function isTxtFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith(".txt");
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

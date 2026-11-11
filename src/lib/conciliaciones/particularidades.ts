// Particularidades de UI por banco (país + slug de `conciliaciones.bancos`).
// Las URLs de los webhooks viven en el servidor (`convertir-txt.ts`).

export type FormatoConversion = "txt" | "excel";

export interface ConversionConfig {
  /** Formato de los archivos diarios que n8n consolida en un solo Excel. */
  formato: FormatoConversion;
  /** Nombre con el que el Excel consolidado se envía a la conciliación. */
  extractoFilename: string;
  /** Extensiones admitidas para los archivos diarios. */
  extensiones: readonly string[];
}

const EXTENSIONES_EXCEL = [".xlsx", ".xls"] as const;

/** Bancos con una conversión propia (clave `PAIS:slug`). */
const BANCOS_CON_CONVERSION: Record<string, ConversionConfig> = {
  "MX:bananorte-mexico": {
    formato: "txt",
    extractoFilename: "banorte_extracto.xlsx",
    extensiones: [".txt"],
  },
  // Pagos referenciados: un reporte diario en .csv (separado por `;`) o Excel.
  "MX:banamex-387-mexico": {
    formato: "excel",
    extractoFilename: "banamex-387-mexico_extracto.xlsx",
    extensiones: [...EXTENSIONES_EXCEL, ".csv"],
  },
};

/**
 * Países donde el resto de bancos entrega reportes diarios en Excel: se pueden
 * unificar varios en uno antes de conciliar.
 */
const PAISES_UNIFICAR_EXCEL = new Set(["MX"]);

export interface DomiciliacionConfig {
  /** Extensiones de los TXT de domiciliación. */
  extensiones: readonly string[];
  /** Máximo de TXT por conciliación (uno por día). */
  max: number;
}

export const EXTENSIONES_DOMICILIACION = [".dom", ".txt"] as const;

/**
 * Bancos que reciben, junto al extracto, los TXT diarios de domiciliación (posiciones
 * fijas). Se suben por Storage y n8n los lee en la misma conciliación (`domiciliacion_N`).
 */
const BANCOS_CON_DOMICILIACION: Record<string, DomiciliacionConfig> = {
  "MX:banamex-681-mexico": { extensiones: EXTENSIONES_DOMICILIACION, max: 31 },
};

export function getDomiciliacion(pais: string, slug: string): DomiciliacionConfig | null {
  return BANCOS_CON_DOMICILIACION[`${pais}:${slug}`] ?? null;
}

export function esArchivoDomiciliacion(filename: string): boolean {
  const lower = filename.toLowerCase();
  return EXTENSIONES_DOMICILIACION.some((ext) => lower.endsWith(ext));
}

export function getConversion(pais: string, slug: string): ConversionConfig | null {
  const propia = BANCOS_CON_CONVERSION[`${pais}:${slug}`];
  if (propia) return propia;
  // El extracto de estos bancos es el reporte Kyriba del mes: no hay diarios que unificar.
  if (getDomiciliacion(pais, slug)) return null;
  if (PAISES_UNIFICAR_EXCEL.has(pais)) {
    return {
      formato: "excel",
      extractoFilename: `${slug}_extracto.xlsx`,
      extensiones: EXTENSIONES_EXCEL,
    };
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

export const FORMATO_LABEL: Record<FormatoConversion, string> = {
  txt: "TXT",
  excel: "Excel",
};

/** Valor para el `accept` del input de archivos. */
export function acceptDeConversion(config: ConversionConfig): string {
  return config.formato === "txt" ? ".txt,text/plain" : config.extensiones.join(",");
}

export function esArchivoDeConversion(filename: string, config: ConversionConfig): boolean {
  const lower = filename.toLowerCase();
  return config.extensiones.some((ext) => lower.endsWith(ext));
}

/** Mensaje cuando un archivo no corresponde al formato esperado. */
export function mensajeFormatoInvalido(filename: string, config: ConversionConfig): string {
  if (config.formato === "txt") return `${filename} no es un archivo .txt.`;
  const lista = config.extensiones.join(", ");
  return config.extensiones.includes(".csv")
    ? `${filename} no es un archivo Excel o CSV (${lista}).`
    : `${filename} no es un archivo Excel (${lista}).`;
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

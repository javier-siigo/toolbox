/** Conciliación de asientos de diario vs balance: tipos y límites (cliente y servidor). */

export type FuenteAsientos = "netsuite" | "archivo";

export interface Subsidiaria {
  id: string;
  nombre: string;
  pais: string;
}

export interface ResumenAsientos {
  cuentas: number | null;
  cruzan: number | null;
  redondeo: number | null;
  noCruzan: number | null;
  sinMovimiento: number | null;
  lineas: number | null;
  difDebito: number | null;
  difCredito: number | null;
}

/** Resumen de la lectura que hizo el navegador; n8n lo muestra en la hoja Resumen. */
export interface LecturaCliente {
  hojas: string[];
  filas: number;
  usadas: number;
  fueraPeriodo: number;
  otraSubsidiaria: number;
  sinCuenta: number;
  columnas: string;
}

/** Valida y recorta lo que manda el navegador (llega tal cual a n8n). */
export function sanearLectura(v: unknown): LecturaCliente | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0);
  return {
    hojas: Array.isArray(o.hojas) ? o.hojas.filter((h): h is string => typeof h === "string").slice(0, 50).map((h) => h.slice(0, 80)) : [],
    filas: n(o.filas),
    usadas: n(o.usadas),
    fueraPeriodo: n(o.fueraPeriodo),
    otraSubsidiaria: n(o.otraSubsidiaria),
    sinCuenta: n(o.sinCuenta),
    columnas: typeof o.columnas === "string" ? o.columnas.slice(0, 300) : "",
  };
}

export const BALANCE_EXTENSIONES = ["xlsx", "csv"] as const;
export const ASIENTOS_EXTENSIONES = ["xlsx", "csv"] as const;

export const MAX_BALANCE_BYTES = 10 * 1024 * 1024;
export const MAX_BALANCE_LABEL = "10 MB";
/**
 * Tope del archivo que llega a Storage. Desde la página el archivo de asientos se resume
 * en el navegador (cualquier tamaño) y lo que se sube es ese resumen, de pocos KB.
 */
export const MAX_ASIENTOS_BYTES = 50 * 1024 * 1024;
export const MAX_ASIENTOS_LABEL = "50 MB";

export const PERIODO_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function extensionAceptada(nombre: string, extensiones: readonly string[]): boolean {
  return extensiones.includes(nombre.split(".").pop()?.toLowerCase() ?? "");
}

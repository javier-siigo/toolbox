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

export const BALANCE_EXTENSIONES = ["xlsx", "csv"] as const;
export const ASIENTOS_EXTENSIONES = ["xlsx", "csv"] as const;

export const MAX_BALANCE_BYTES = 10 * 1024 * 1024;
export const MAX_BALANCE_LABEL = "10 MB";
/**
 * n8n lee el archivo completo en memoria: un mes entero de SIIGO S.A.S (~2 millones de
 * líneas) no cabe; para eso está la consulta automática a NetSuite.
 */
export const MAX_ASIENTOS_BYTES = 50 * 1024 * 1024;
export const MAX_ASIENTOS_LABEL = "50 MB";

export const PERIODO_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function extensionAceptada(nombre: string, extensiones: readonly string[]): boolean {
  return extensiones.includes(nombre.split(".").pop()?.toLowerCase() ?? "");
}

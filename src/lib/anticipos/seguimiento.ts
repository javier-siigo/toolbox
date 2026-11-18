import type { Alerta, NivelAlerta } from "@/lib/servicios-publicos/alertas";

import type { AnticipoRow } from "./schema";

/**
 * Semáforo de anticipos. ÚNICA fuente de la regla de vencimiento: la tabla, los indicadores,
 * el detalle, el Excel y el Inicio llaman a `seguimientoDe` y nunca deciden por su cuenta.
 *
 *   ok        verde     legalizado (falta = legalizado; solo lo pone el botón Legalizar)
 *   atencion  amarillo  sin legalizar, hoy ≤ fecha máxima de legalización
 *   revisar   rojo      sin legalizar y ya pasó la fecha máxima de legalización (vencido)
 *
 * La fecha de gestión y la observación son solo seguimiento: no detienen el conteo ni
 * cierran el anticipo. Mientras no esté legalizado, el reloj sigue corriendo.
 *
 * Fecha máxima de legalización = fecha final + DIAS_LEGALIZACION días corridos
 * (se cuentan desde el día siguiente a la fecha final). Ej.: final 1 nov → máxima 9 nov;
 * el 11 nov está vencido 2 días.
 */

/** Días corridos, desde el día siguiente a la fecha final, para legalizar. */
export const DIAS_LEGALIZACION = 8;

export interface Seguimiento extends Alerta {
  /** Días de vencimiento (negativo = días que faltan para vencer); null si ya está legalizado. */
  dias: number | null;
}

export const NIVEL_SEGUIMIENTO_LABEL: Record<NivelAlerta, string> = {
  ok: "Legalizado",
  atencion: "En plazo",
  revisar: "Vencido",
};

export const PESO_SEGUIMIENTO: Record<NivelAlerta, number> = {
  revisar: 0,
  atencion: 1,
  ok: 2,
};

function diasEntre(desde: string, hasta: string): number {
  const [y1, m1, d1] = desde.split("-").map(Number);
  const [y2, m2, d2] = hasta.split("-").map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0;
  return Math.floor((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** `YYYY-MM-DD` de la fecha máxima de legalización; null si la fecha final no es válida. */
export function fechaMaximaLegalizacion(fechaFinal: string | null | undefined): string | null {
  if (!fechaFinal) return null;
  const [y, m, d] = fechaFinal.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d + DIAS_LEGALIZACION)).toISOString().slice(0, 10);
}

function plural(n: number): string {
  return `${n} ${n === 1 ? "día" : "días"}`;
}

/** `hoy` en `YYYY-MM-DD` (hora de Colombia; la calcula el servidor). */
export function seguimientoDe(
  r: Pick<AnticipoRow, "falta" | "fecha_rq">,
  hoy: string,
): Seguimiento {
  if (r.falta === "legalizado") {
    return { nivel: "ok", motivo: "Sin pendientes", dias: null };
  }
  const maxima = fechaMaximaLegalizacion(r.fecha_rq);
  if (!maxima) return { nivel: "atencion", motivo: "Sin fecha final", dias: null };
  const dias = diasEntre(maxima, hoy);
  if (dias > 0) return { nivel: "revisar", motivo: `Vencido ${plural(dias)}`, dias };
  if (dias === 0) return { nivel: "atencion", motivo: "Vence hoy", dias };
  return { nivel: "atencion", motivo: `Vence en ${plural(-dias)}`, dias };
}

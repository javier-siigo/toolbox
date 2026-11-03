import type { Alerta, NivelAlerta } from "@/lib/servicios-publicos/alertas";

import type { AnticipoRow } from "./schema";

/**
 * Semáforo de anticipos. ÚNICA fuente de la regla de atraso: la tabla, los indicadores,
 * el detalle y el Excel llaman a `seguimientoDe` y nunca deciden por su cuenta.
 *
 *   ok        verde     legalizado o con fecha de gestión
 *   atencion  amarillo  pendiente, aún en plazo
 *   revisar   rojo      pendiente con ≥ DIAS_ATRASO días desde la fecha de RQ
 */

/** Días desde la fecha de RQ sin gestión para considerar un anticipo atrasado. */
export const DIAS_ATRASO = 10;

export interface Seguimiento extends Alerta {
  /** Días desde la fecha de RQ; null si ya está resuelto. */
  dias: number | null;
}

export const NIVEL_SEGUIMIENTO_LABEL: Record<NivelAlerta, string> = {
  ok: "Resuelto",
  atencion: "En plazo",
  revisar: "Atrasado",
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

export function esResuelto(r: Pick<AnticipoRow, "falta" | "observacion_1" | "fecha_gestion">): boolean {
  return r.falta === "legalizado" || r.observacion_1 === "legalizado" || r.fecha_gestion !== null;
}

/** `hoy` en `YYYY-MM-DD` (hora de Colombia; la calcula el servidor). */
export function seguimientoDe(r: AnticipoRow, hoy: string): Seguimiento {
  if (r.falta === "legalizado" || r.observacion_1 === "legalizado") {
    return { nivel: "ok", motivo: "Legalizado", dias: null };
  }
  if (r.fecha_gestion !== null) {
    return { nivel: "ok", motivo: "Gestionado", dias: null };
  }
  const dias = Math.max(0, diasEntre(r.fecha_rq, hoy));
  const texto = dias === 0 ? "RQ de hoy" : `${dias} ${dias === 1 ? "día" : "días"} sin gestión`;
  if (dias >= DIAS_ATRASO) return { nivel: "revisar", motivo: texto, dias };
  return { nivel: "atencion", motivo: texto, dias };
}

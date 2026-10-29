import { diasEntre, type Recibo } from "./schema";

/**
 * Semáforo de servicios públicos. ÚNICA fuente de las reglas de alerta: la tabla, los
 * indicadores, los filtros y el detalle llaman a `alertaDe` y nunca deciden por su cuenta.
 *
 *   ok        verde     gestionado o al día
 *   atencion  amarillo  se acerca un plazo o falta algo menor (p. ej. el soporte)
 *   revisar   rojo      un plazo ya pasó: hay que hacer seguimiento
 */

/** Días antes del corte en que un recibo sin factura pasa a amarillo. */
export const DIAS_AVISO_CORTE = 3;
/** Días con la factura en mano sin registrarla antes de pasar a rojo. */
export const DIAS_PARA_REGISTRAR = 3;
/** Días desde el registro (envío a Tesorería) sin pago antes de pasar a rojo. */
export const DIAS_PARA_PAGO = 10;

export type NivelAlerta = "ok" | "atencion" | "revisar";

export interface Alerta {
  nivel: NivelAlerta;
  /** Qué pasa, en pocas palabras. */
  motivo: string;
}

export const NIVEL_ALERTA_LABEL: Record<NivelAlerta, string> = {
  ok: "Al día",
  atencion: "Atención",
  revisar: "Requiere revisión",
};

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** `hoy` en `YYYY-MM-DD` (hora de Colombia; la calcula el servidor para no depender del reloj del navegador). */
export function alertaDe(r: Recibo, hoy: string): Alerta {
  switch (r.estado) {
    case "pendiente_factura": {
      if (!r.fecha_corte) return { nivel: "atencion", motivo: "Sin fecha de corte" };
      const faltan = diasEntre(hoy, r.fecha_corte);
      if (faltan < 0) {
        return { nivel: "revisar", motivo: `Corte hace ${plural(-faltan, "día", "días")} y no llega la factura` };
      }
      if (faltan === 0) return { nivel: "atencion", motivo: "El corte es hoy" };
      if (faltan <= DIAS_AVISO_CORTE) {
        return { nivel: "atencion", motivo: `Corte en ${plural(faltan, "día", "días")}` };
      }
      return { nivel: "ok", motivo: "Esperando factura" };
    }
    case "recibido": {
      const dias = diasEntre(r.fecha_recibido!, hoy);
      if (dias > DIAS_PARA_REGISTRAR) {
        return { nivel: "revisar", motivo: `Factura sin registrar hace ${plural(dias, "día", "días")}` };
      }
      return { nivel: "atencion", motivo: "Falta registrarlo" };
    }
    case "registrado": {
      const dias = diasEntre(r.fecha_registro!, hoy);
      if (dias > DIAS_PARA_PAGO) {
        return { nivel: "revisar", motivo: `Sin pago hace ${plural(dias, "día", "días")}` };
      }
      return { nivel: "atencion", motivo: "En Tesorería, pendiente de pago" };
    }
    case "pagado":
      if (!r.soporte_nombre) return { nivel: "atencion", motivo: "Pagado, falta el soporte" };
      return { nivel: "ok", motivo: "Pagado con soporte" };
  }
}

/** Orden para la tabla: lo urgente arriba. */
export const PESO_ALERTA: Record<NivelAlerta, number> = { revisar: 0, atencion: 1, ok: 2 };

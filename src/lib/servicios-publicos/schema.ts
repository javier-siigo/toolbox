import { z } from "zod";

/**
 * Servicios públicos: tipos, validación y etiquetas. Seguro para cliente y servidor.
 *
 * El estado de un recibo no se elige: se deriva de sus fechas en la BD (columna generada
 * `estado`), y los checks de la tabla impiden combinaciones ambiguas. Ver la migración
 * `20261029200000_servicios_publicos.sql`.
 */

export const ESTADOS = ["pendiente_factura", "recibido", "registrado", "pagado"] as const;
export type EstadoRecibo = (typeof ESTADOS)[number];

export const ESTADO_LABEL: Record<EstadoRecibo, string> = {
  pendiente_factura: "Pendiente de factura",
  recibido: "Factura recibida",
  registrado: "Registrado · pendiente de pago",
  pagado: "Pagado",
};

/** Etiqueta corta para chips y filtros. */
export const ESTADO_CORTO: Record<EstadoRecibo, string> = {
  pendiente_factura: "Sin factura",
  recibido: "Por registrar",
  registrado: "Pendiente de pago",
  pagado: "Pagado",
};

export function esEstado(value: string): value is EstadoRecibo {
  return (ESTADOS as readonly string[]).includes(value);
}

export const MAX_RECIBOS = 3000;
export const SOPORTE_BUCKET = "servicios-publicos-soportes";
export const SOPORTE_MAX_BYTES = 10 * 1024 * 1024;
export const SOPORTE_TIPOS = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
] as const;
export const SOPORTE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic";

export interface Servicio {
  id: string;
  proveedor: string;
  servicio: string;
  referencia: string | null;
  dia_corte: number | null;
  activo: boolean;
  notas: string | null;
}

export interface Recibo {
  id: string;
  servicio_id: string;
  proveedor: string;
  servicio: string;
  /** `YYYY-MM`. */
  mes: string;
  referencia: string | null;
  valor: number | null;
  fecha_corte: string | null;
  fecha_recibido: string | null;
  fecha_registro: string | null;
  fecha_pago: string | null;
  soporte_nombre: string | null;
  soporte_subido_at: string | null;
  observaciones: string | null;
  estado: EstadoRecibo;
  updated_at: string;
}

export interface EventoHistorial {
  id: number;
  evento: "creado" | "estado" | "valor" | "soporte";
  detalle: string;
  usuario: string | null;
  at: string;
}

// ─── Fechas ────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function fechaValida(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** Días de `desde` a `hasta` (ISO `YYYY-MM-DD`). Positivo si `hasta` es posterior. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round(
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000,
  );
}

/** Fecha de corte de un mes a partir del día del servicio (31 en febrero → 28/29). Igual que `preparar_mes`. */
export function corteDelMes(mes: string, dia: number): string {
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${mes}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
}

const fechaOpcional = z
  .string()
  .trim()
  .refine((v) => v === "" || fechaValida(v), { message: "Fecha inválida" });

// ─── Recibo ────────────────────────────────────────────────────────────────

/**
 * Formulario de recibo (crear y editar). Las reglas de orden replican los checks de la BD
 * para que el usuario vea el error en el campo y no un mensaje técnico.
 */
export const reciboSchema = z
  .object({
    id: z.string().uuid().optional().or(z.literal("")),
    servicio_id: z.string().uuid({ message: "Elige el servicio" }),
    mes: z.string().regex(MES_RE, { message: "Elige el mes" }),
    referencia: z.string().trim().max(80, "Máximo 80 caracteres"),
    valor: z
      .string()
      .trim()
      .refine((v) => v === "" || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0), {
        message: "Valor inválido (solo números, sin puntos de miles)",
      }),
    fecha_corte: fechaOpcional,
    fecha_recibido: fechaOpcional,
    fecha_registro: fechaOpcional,
    fecha_pago: fechaOpcional,
    observaciones: z.string().trim().max(1000, "Máximo 1.000 caracteres"),
  })
  .superRefine((v, ctx) => {
    if (v.fecha_registro && !v.fecha_recibido) {
      ctx.addIssue({ code: "custom", path: ["fecha_recibido"], message: "Para registrar, indica cuándo llegó la factura" });
    }
    if (v.fecha_registro && v.valor === "") {
      ctx.addIssue({ code: "custom", path: ["valor"], message: "El valor es obligatorio para registrar el recibo" });
    }
    if (v.fecha_pago && !v.fecha_registro) {
      ctx.addIssue({ code: "custom", path: ["fecha_registro"], message: "Un recibo pagado debe estar registrado" });
    }
    if (v.fecha_registro && v.fecha_recibido && v.fecha_registro < v.fecha_recibido) {
      ctx.addIssue({ code: "custom", path: ["fecha_registro"], message: "No puede ser anterior a la llegada de la factura" });
    }
    if (v.fecha_pago && v.fecha_registro && v.fecha_pago < v.fecha_registro) {
      ctx.addIssue({ code: "custom", path: ["fecha_pago"], message: "No puede ser anterior al registro" });
    }
  });

export type ReciboInput = z.infer<typeof reciboSchema>;
export type ReciboField = keyof ReciboInput;

export const pasoSchema = z.object({
  id: z.string().uuid(),
  paso: z.enum(["registrar", "pagar"]),
  fecha: z.string().refine(fechaValida, { message: "Fecha inválida" }),
});

// ─── Servicio ──────────────────────────────────────────────────────────────

export const servicioSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  proveedor: z.string().trim().min(2, "Mínimo 2 caracteres").max(120, "Máximo 120 caracteres"),
  servicio: z.string().trim().min(2, "Mínimo 2 caracteres").max(80, "Máximo 80 caracteres"),
  referencia: z.string().trim().max(80, "Máximo 80 caracteres"),
  dia_corte: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 31), {
      message: "Día entre 1 y 31",
    }),
  notas: z.string().trim().max(500, "Máximo 500 caracteres"),
});

export type ServicioInput = z.infer<typeof servicioSchema>;
export type ServicioField = keyof ServicioInput;

/** Sugerencias para el campo "servicio"; se puede escribir cualquier otro. */
export const TIPOS_SERVICIO = ["Energía", "Acueducto", "Gas", "Aseo", "Internet", "Telefonía"] as const;

// ─── Formato ───────────────────────────────────────────────────────────────

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export function formatValor(value: number | null): string {
  return value === null ? "—" : COP.format(value);
}

const FECHA_CORTA = new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "short", timeZone: "UTC" });

/** "2026-10-05" → "05 oct". */
export function formatFecha(value: string | null): string {
  if (!value) return "—";
  return FECHA_CORTA.format(new Date(`${value}T00:00:00Z`)).replace(".", "");
}

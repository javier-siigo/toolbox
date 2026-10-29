import { z } from "zod";

import type { Database } from "@/types/supabase";

export const ANTICIPOS_FALTA_LABELS = {
  permisos_de_soportes: "Permisos de soportes",
  revisar_descuento_nomina: "Revisar descuento de nómina",
  autorizacion_descuento_nomina: "Autorización descuento de nómina",
  legalizado: "Legalizado",
  revisar_soportes: "Revisar soportes",
  devolucion: "Devolución",
  autorizacion_soportes: "Autorización soportes",
  revisar_con_harold: "Revisar con Harold",
  soportes: "Soportes",
} as const satisfies Record<
  Database["anticipos"]["Enums"]["falta"],
  string
>;

export const ANTICIPOS_OBSERVACION_1_LABELS = {
  no_se_ha_contactado: "No se ha contactado",
  escrito_1_vez: "Escrito 1 vez",
  escrito_2_veces: "Escrito 2 veces",
  escrito_3_veces: "Escrito 3 veces",
  legalizado: "Legalizado",
  correo_al_lider: "Correo al líder",
} as const satisfies Record<
  Database["anticipos"]["Enums"]["observacion_1"],
  string
>;

export type AnticipoFalta = Database["anticipos"]["Enums"]["falta"];
export type AnticipoObservacion1 =
  Database["anticipos"]["Enums"]["observacion_1"];

export const ANTICIPOS_FALTA_OPTIONS = Object.entries(ANTICIPOS_FALTA_LABELS).map(
  ([value, label]) => ({ value: value as AnticipoFalta, label }),
);

export const ANTICIPOS_OBSERVACION_1_OPTIONS = Object.entries(
  ANTICIPOS_OBSERVACION_1_LABELS,
).map(([value, label]) => ({ value: value as AnticipoObservacion1, label }));

const YYYY_MM_DD_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(value: string): boolean {
  if (!YYYY_MM_DD_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return false;
  const date = new Date(`${value}T00:00:00`);
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() + 1 === m &&
    date.getUTCDate() === d
  );
}

export const anticipoCreateSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, "El nombre debe tener al menos 2 caracteres")
    .max(120, "Máximo 120 caracteres"),
  requerimiento: z
    .string()
    .trim()
    .min(1, "El requerimiento es obligatorio")
    .max(120, "Máximo 120 caracteres"),
  falta: z.enum(
    Object.keys(ANTICIPOS_FALTA_LABELS) as [AnticipoFalta, ...AnticipoFalta[]],
  ),
  observacion_1: z.enum(
    Object.keys(ANTICIPOS_OBSERVACION_1_LABELS) as [
      AnticipoObservacion1,
      ...AnticipoObservacion1[],
    ],
  ),
  observacion_2: z
    .string()
    .trim()
    .max(500, "Máximo 500 caracteres")
    .optional()
    .or(z.literal("")),
  fecha_rq: z.string().refine(isValidIsoDate, {
    message: "Fecha de RQ inválida",
  }),
  fecha_gestion: z
    .string()
    .refine((v) => v === "" || isValidIsoDate(v), {
      message: "Fecha de gestión inválida",
    }),
});

export type AnticipoCreateInput = z.infer<typeof anticipoCreateSchema>;

export type AnticipoCreateField = keyof AnticipoCreateInput;

export const anticipoIdSchema = z.object({
  id: z.string().uuid(),
});

export type AnticipoIdInput = z.infer<typeof anticipoIdSchema>;

export const anticipoUpdateSchema = anticipoCreateSchema.extend({
  id: z.string().uuid(),
});

export type AnticipoUpdateInput = z.infer<typeof anticipoUpdateSchema>;

export type AnticipoUpdateField = keyof AnticipoUpdateInput;

export const ANTICIPOS_PAGE_SIZE = 10;

export const MAX_ANTICIPOS_ROWS = 1000;

export const anticipoListFiltersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  falta: z
    .enum(
      Object.keys(ANTICIPOS_FALTA_LABELS) as [AnticipoFalta, ...AnticipoFalta[]],
    )
    .optional()
    .or(z.literal("")),
  observacion_1: z
    .enum(
      Object.keys(ANTICIPOS_OBSERVACION_1_LABELS) as [
        AnticipoObservacion1,
        ...AnticipoObservacion1[],
      ],
    )
    .optional()
    .or(z.literal("")),
});

export type AnticipoListFilters = z.infer<typeof anticipoListFiltersSchema>;

export type AnticipoRow = {
  id: string;
  nombre: string;
  requerimiento: string;
  falta: AnticipoFalta;
  observacion_1: AnticipoObservacion1;
  observacion_2: string | null;
  fecha_rq: string;
  fecha_gestion: string | null;
  created_at: string;
  es_retirado: boolean;
  retiro_info: {
    cedula: number;
    nombre: string;
    valor: number | null;
    observacion: string | null;
    fecha_reporte: string;
    nivel: "exacto" | "exacto_inverso" | "parcial";
    tokensComunes: string[];
    tokensExtra: string[];
  } | null;
};

export type AnticipoListResult = {
  rows: AnticipoRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysSinceIsoDate(iso: string, now: Date = new Date()): number {
  if (!iso) return -1;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return -1;
  const target = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((today - target) / 86_400_000);
}

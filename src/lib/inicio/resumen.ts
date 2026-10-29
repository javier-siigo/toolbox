import "server-only";

import { listUsersWithRoles } from "@/lib/admin/users";
import { canAccessProceso, isAdmin, type UserRolesInfo } from "@/lib/auth/roles";
import { daysSinceIsoDate } from "@/lib/anticipos/schema";
import { periodoActual, periodoLabel, shiftPeriodo } from "@/lib/comisiones/calculo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Cifras del Inicio, solo de lo que el usuario puede ver. Cada parte falla
 * por separado: `null` = no se pudo leer; ausente = sin acceso.
 */

/** Días desde la fecha de RQ a partir de los cuales un anticipo cuenta como atrasado (igual que la tabla). */
export const DIAS_ATRASO = 10;

export interface ResumenAnticipos {
  total: number;
  pendientes: number;
  atrasados: number;
  legalizados: number;
  devoluciones: number;
}

export interface ResumenComisiones {
  /** `YYYY-MM` del cierre que toca (el mes anterior). */
  periodo: string;
  etiqueta: string;
  /** Pasos hechos del cierre, en orden. */
  hechos: [boolean, boolean, boolean, boolean];
  /** 1–4, o `null` si el cierre está completo. */
  pasoActual: number | null;
}

export interface ResumenAdmin {
  usuarios: number;
  sinRol: number;
}

export interface ResumenInicio {
  anticipos?: ResumenAnticipos | null;
  comisiones?: ResumenComisiones | null;
  /** Bancos activos por país (`CO` → 6). */
  bancos?: Record<string, number> | null;
  admin?: ResumenAdmin | null;
}

/** Hora de Colombia: el servidor corre en UTC y el equipo trabaja en Bogotá. */
export function ahoraBogota(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
}

async function intentar<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error("[inicio]", err);
    return null;
  }
}

async function resumenAnticipos(ahora: Date): Promise<ResumenAnticipos> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("anticipos").from("registros")
    .select("falta, observacion_1, fecha_rq, fecha_gestion");
  if (error) throw new Error(error.message);
  const filas = data ?? [];
  let pendientes = 0;
  let atrasados = 0;
  let devoluciones = 0;
  for (const r of filas) {
    if (r.falta !== "legalizado") pendientes++;
    if (r.falta === "devolucion") devoluciones++;
    // Misma regla que la columna "Fecha RQ" de la tabla de anticipos.
    const resuelto =
      r.falta === "legalizado" || r.observacion_1 === "legalizado" || r.fecha_gestion !== null;
    if (!resuelto && r.fecha_rq && daysSinceIsoDate(r.fecha_rq, ahora) >= DIAS_ATRASO) atrasados++;
  }
  return {
    total: filas.length,
    pendientes,
    atrasados,
    legalizados: filas.length - pendientes,
    devoluciones,
  };
}

/**
 * Paso del cierre del mes anterior, con las mismas condiciones que la banda
 * "Siguiente" del cálculo de comisiones (sin el informe, que solo vive en el navegador).
 */
async function resumenComisiones(ahora: Date): Promise<ResumenComisiones> {
  const supabase = await createClient();
  const periodo = shiftPeriodo(periodoActual(ahora), -1);
  const [valores, bases, reconocimientos, cierre] = await Promise.all([
    supabase.schema("comisiones").from("periodo_valores").select("valor").eq("periodo", periodo),
    supabase
      .schema("comisiones").from("bases")
      .select("facturas, notas_credito")
      .eq("periodo", periodo),
    supabase
      .schema("comisiones").from("reconocimientos")
      .select("cohorte", { count: "exact", head: true })
      .eq("periodo", periodo),
    supabase.schema("comisiones").from("cierres").select("periodo").eq("periodo", periodo).maybeSingle(),
  ]);
  for (const r of [valores, bases, reconocimientos, cierre]) {
    if (r.error) throw new Error(r.error.message);
  }
  const pool = (valores.data ?? []).reduce((a, v) => a + Number(v.valor ?? 0), 0);
  const neto = (bases.data ?? []).reduce(
    (a, b) => a + Number(b.facturas ?? 0) - Number(b.notas_credito ?? 0),
    0,
  );
  const registrado = (reconocimientos.count ?? 0) > 0;
  const guardado = cierre.data !== null;
  const hechos: ResumenComisiones["hechos"] = [
    pool !== 0,
    neto > 0,
    registrado || guardado,
    guardado || registrado,
  ];
  const i = hechos.indexOf(false);
  return { periodo, etiqueta: periodoLabel(periodo), hechos, pasoActual: i === -1 ? null : i + 1 };
}

async function resumenBancos(paises: string[] | null): Promise<Record<string, number>> {
  const admin = createAdminClient();
  let q = admin.schema("conciliaciones").from("bancos").select("pais").eq("activo", true);
  if (paises) q = q.in("pais", paises);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[r.pais as string] = (out[r.pais as string] ?? 0) + 1;
  return out;
}

async function resumenAdmin(): Promise<ResumenAdmin> {
  const usuarios = await listUsersWithRoles();
  return { usuarios: usuarios.length, sinRol: usuarios.filter((u) => u.roles.length === 0).length };
}

export async function resumenInicio(roles: UserRolesInfo, ahora: Date): Promise<ResumenInicio> {
  const ingresos = canAccessProceso(roles, "ingresos", { slug: "gestion-anticipos" });
  const admin = isAdmin(roles);
  const conciliaciones = admin || roles.roles.includes("conciliaciones");

  const [anticipos, comisiones, bancos, resumenAdm] = await Promise.all([
    ingresos ? intentar(() => resumenAnticipos(ahora)) : undefined,
    ingresos ? intentar(() => resumenComisiones(ahora)) : undefined,
    conciliaciones ? intentar(() => resumenBancos(admin ? null : roles.paises)) : undefined,
    admin ? intentar(resumenAdmin) : undefined,
  ]);
  return { anticipos, comisiones, bancos, admin: resumenAdm };
}

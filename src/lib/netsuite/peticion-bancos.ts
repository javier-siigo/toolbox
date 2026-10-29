import "server-only";

import { NextResponse } from "next/server";

import { getUserRoles, hasIngresosOrAdmin } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

import type { CampoCatalogo } from "./campos";
import { NetSuiteError } from "./client";
import { filtrosSchema, validarFiltros, type Filtro } from "./filtros";
import { validarRango } from "./rango-fechas";

/** Comprobaciones comunes de las rutas de la exportación de bancos. */

export function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export const NETSUITE_STATUS: Record<NetSuiteError["code"], number> = {
  netsuite_config: 500,
  netsuite_auth: 502,
  netsuite_query: 502,
  netsuite_limit: 422,
  timeout: 504,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

type Resultado<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Sesión con rol ingresos o admin y cuerpo JSON (objeto). */
export async function leerSesion(request: Request): Promise<
  Resultado<{ supabase: Supabase; userId: string; body: Record<string, unknown> }>
> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return { ok: false, response: jsonError("Tu sesión expiró. Vuelve a iniciar sesión.", "unauthorized", 401) };
  }
  const userId = data.claims.sub;
  const roles = await getUserRoles(userId);
  if (!hasIngresosOrAdmin(roles)) {
    return { ok: false, response: jsonError("No tienes permisos para esta exportación.", "forbidden", 403) };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: jsonError("Cuerpo inválido: se esperaba JSON", "bad_request", 400) };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, response: jsonError("Cuerpo inválido: se esperaba un objeto", "bad_request", 400) };
  }
  return { ok: true, data: { supabase, userId, body: body as Record<string, unknown> } };
}

/** `leerSesion` más un rango de fechas válido en el cuerpo. */
export async function leerPeticion(request: Request): Promise<
  Resultado<{
    supabase: Supabase;
    userId: string;
    body: Record<string, unknown>;
    fechaInicio: string;
    fechaFin: string;
  }>
> {
  const sesion = await leerSesion(request);
  if (!sesion.ok) return sesion;
  const { fechaInicio, fechaFin } = sesion.data.body;
  if (typeof fechaInicio !== "string" || typeof fechaFin !== "string") {
    return { ok: false, response: jsonError("Faltan fechaInicio y fechaFin (YYYY-MM-DD).", "bad_request", 400) };
  }
  const rangoError = validarRango(fechaInicio, fechaFin);
  if (rangoError) return { ok: false, response: jsonError(rangoError, "invalid_range", 400) };

  return { ok: true, data: { ...sesion.data, fechaInicio, fechaFin } };
}

/**
 * Lee del catálogo (solo habilitados) los campos pedidos. El SQL se arma con
 * estas filas, nunca con texto enviado por el cliente.
 */
export async function camposHabilitados(
  supabase: Supabase,
  ids: string[],
): Promise<Resultado<Map<string, CampoCatalogo>>> {
  if (ids.length === 0) return { ok: true, data: new Map() };
  const { data, error } = await supabase
    .schema("export_bancos").from("campos")
    .select("id, tabla, campo, modo, etiqueta, tipo, habilitado, orden")
    .in("id", ids)
    .eq("habilitado", true)
    .order("orden");
  if (error) {
    return { ok: false, response: jsonError("No se pudo leer el catálogo de campos.", "internal", 500) };
  }
  return { ok: true, data: new Map((data as CampoCatalogo[]).map((c) => [c.id, c])) };
}

/** Valida forma y contenido de los filtros y carga sus campos. */
export async function leerFiltros(
  supabase: Supabase,
  raw: unknown,
): Promise<Resultado<{ filtros: Filtro[]; campos: Map<string, CampoCatalogo> }>> {
  const parsed = filtrosSchema.safeParse(raw ?? []);
  if (!parsed.success) {
    return {
      ok: false,
      response: jsonError(parsed.error.issues[0]?.message ?? "Filtros inválidos.", "invalid_filters", 400),
    };
  }
  const filtros = parsed.data as Filtro[];
  const campos = await camposHabilitados(supabase, [...new Set(filtros.map((f) => f.campoId))]);
  if (!campos.ok) return campos;
  const error = validarFiltros(filtros, campos.data);
  if (error) return { ok: false, response: jsonError(error, "invalid_filters", 400) };
  return { ok: true, data: { filtros, campos: campos.data } };
}

export function respuestaDeError(err: unknown, contexto: string) {
  console.error(`[${contexto}]`, err);
  if (err instanceof NetSuiteError) {
    return jsonError(err.message, err.code, NETSUITE_STATUS[err.code]);
  }
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return jsonError("NetSuite tardó demasiado en responder. Intenta de nuevo.", "timeout", 504);
  }
  return null;
}

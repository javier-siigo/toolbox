import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import {
  SIN_PERMISOS,
  esNivel,
  esProcesoId,
  nivelEn,
  puede,
  type Nivel,
  type Permisos,
  type ProcesoId,
} from "./permisos-shared";

/**
 * Capa de acceso: el ÚNICO lugar donde se decide si una petición puede tocar un proceso.
 *
 *   Páginas         `await requireAcceso(PROCESOS.X)`           → 404 sin acceso, /login sin sesión
 *   Server actions  `const a = await autorizar(PROCESOS.X, "usar")`; `if (!a.ok) return …`
 *   Route handlers  igual que las actions; `respuestaDenegada(a)` arma el JSON 401/403
 *
 * No proteger desde layouts: no se re-ejecutan al navegar y no cubren server actions.
 * RLS (`private.tiene_acceso`) repite la regla en la BD; esto da el error claro antes.
 * `npm run check:acceso` falla si una página, action o ruta no pasa por aquí.
 */

export const SESION_EXPIRADA = "Tu sesión expiró. Vuelve a iniciar sesión.";
export const SIN_ACCESO = "No tienes permisos para esta acción.";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface Sesion {
  supabase: Supabase;
  userId: string;
  email: string;
  nombre: string;
  permisos: Permisos;
}

const leerPermisos = unstable_cache(
  async (userId: string): Promise<Permisos> => {
    const admin = createAdminClient();
    const [usuario, permisos] = await Promise.all([
      admin.schema("core").from("usuarios").select("es_admin").eq("user_id", userId).maybeSingle(),
      admin.schema("core").from("permisos").select("proceso_id, nivel").eq("user_id", userId),
    ]);
    if (usuario.error || permisos.error) return SIN_PERMISOS;
    const procesos: Permisos["procesos"] = {};
    for (const row of permisos.data ?? []) {
      if (esProcesoId(row.proceso_id) && esNivel(row.nivel)) procesos[row.proceso_id] = row.nivel;
    }
    return { esAdmin: Boolean(usuario.data?.es_admin), procesos };
  },
  ["permisos"],
  { revalidate: 60, tags: ["permisos"] },
);

/** Sesión del request (una sola lectura por render gracias a `cache`). `null` sin sesión. */
export const getSesion = cache(async (): Promise<Sesion | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) return null;
  const email = (data.claims.email as string | undefined) ?? "";
  const nombre =
    (data.claims.user_metadata?.name as string | undefined) || email.split("@")[0] || "Usuario";
  return { supabase, userId, email, nombre, permisos: await leerPermisos(userId) };
});

// ─── Páginas ────────────────────────────────────────────────────────────────

export async function requireSesion(): Promise<Sesion> {
  const sesion = await getSesion();
  if (!sesion) redirect("/login");
  return sesion;
}

/** Para páginas de proceso. Devuelve además el nivel, para que la UI oculte lo que no aplica. */
export async function requireAcceso(
  proceso: ProcesoId,
  nivel: Nivel = "ver",
): Promise<Sesion & { nivel: Nivel }> {
  const sesion = await requireSesion();
  if (!puede(sesion.permisos, proceso, nivel)) notFound();
  return { ...sesion, nivel: nivelEn(sesion.permisos, proceso)! };
}

export async function requireAdmin(): Promise<Sesion> {
  const sesion = await requireSesion();
  if (!sesion.permisos.esAdmin) notFound();
  return sesion;
}

// ─── Server actions y route handlers ───────────────────────────────────────

export type Autorizacion =
  | ({ ok: true } & Sesion)
  | { ok: false; error: string; status: 401 | 403 };

export async function autorizar(proceso: ProcesoId, nivel: Nivel = "usar"): Promise<Autorizacion> {
  const sesion = await getSesion();
  if (!sesion) return { ok: false, error: SESION_EXPIRADA, status: 401 };
  if (!puede(sesion.permisos, proceso, nivel)) return { ok: false, error: SIN_ACCESO, status: 403 };
  return { ok: true, ...sesion };
}

export async function autorizarAdmin(): Promise<Autorizacion> {
  const sesion = await getSesion();
  if (!sesion) return { ok: false, error: SESION_EXPIRADA, status: 401 };
  if (!sesion.permisos.esAdmin) return { ok: false, error: SIN_ACCESO, status: 403 };
  return { ok: true, ...sesion };
}

/** Respuesta JSON para route handlers, con el mismo formato `{ error, code }` del resto de APIs. */
export function respuestaDenegada(a: Extract<Autorizacion, { ok: false }>): NextResponse {
  return NextResponse.json(
    { error: a.error, code: a.status === 401 ? "unauthorized" : "forbidden" },
    { status: a.status },
  );
}

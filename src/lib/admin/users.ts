"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";

import { autorizarAdmin } from "@/lib/auth/acceso";
import {
  NIVELES,
  TODOS_LOS_PROCESOS,
  esNivel,
  esProcesoId,
  type Nivel,
  type ProcesoId,
} from "@/lib/auth/permisos-shared";
import { createAdminClient } from "@/lib/supabase/admin";

export interface UsuarioConPermisos {
  id: string;
  email: string;
  esAdmin: boolean;
  procesos: Partial<Record<ProcesoId, Nivel>>;
  lastSignInAt: string | null;
  /** Última request con sesión (`core.user_activity`, se escribe cada ≥5 min). */
  lastSeenAt: string | null;
}

const updateSchema = z.object({
  userId: z.string().uuid("userId inválido"),
  esAdmin: z.boolean(),
  procesos: z.partialRecord(z.enum(TODOS_LOS_PROCESOS as [ProcesoId, ...ProcesoId[]]), z.enum(NIVELES)),
});

export type UpdatePermisosInput = z.infer<typeof updateSchema>;

export type UpdatePermisosResult = { ok: true } | { ok: false; error: string };

export async function listUsuarios(): Promise<UsuarioConPermisos[]> {
  const acceso = await autorizarAdmin();
  if (!acceso.ok) throw new Error(acceso.error);
  const admin = createAdminClient();

  const [usuarios, permisos, actividad] = await Promise.all([
    admin.schema("core").from("usuarios").select("user_id, es_admin"),
    admin.schema("core").from("permisos").select("user_id, proceso_id, nivel"),
    admin.schema("core").from("user_activity").select("user_id, last_seen_at"),
  ]);
  const error = usuarios.error ?? permisos.error ?? actividad.error;
  if (error) throw new Error(error.message);

  const esAdmin = new Set((usuarios.data ?? []).filter((u) => u.es_admin).map((u) => u.user_id));
  const porUsuario = new Map<string, Partial<Record<ProcesoId, Nivel>>>();
  for (const p of permisos.data ?? []) {
    if (!esProcesoId(p.proceso_id) || !esNivel(p.nivel)) continue;
    const actual = porUsuario.get(p.user_id) ?? {};
    actual[p.proceso_id] = p.nivel;
    porUsuario.set(p.user_id, actual);
  }
  const lastSeen = new Map((actividad.data ?? []).map((r) => [r.user_id, r.last_seen_at]));

  // `core.usuarios` y `core.permisos` tienen FK con cascade a auth.users: no hay huérfanos.
  const out: UsuarioConPermisos[] = [];
  let page = 1;
  while (true) {
    const { data, error: authError } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (authError) throw new Error(authError.message);
    for (const u of data.users) {
      if (!u.email) continue;
      out.push({
        id: u.id,
        email: u.email,
        esAdmin: esAdmin.has(u.id),
        procesos: porUsuario.get(u.id) ?? {},
        lastSignInAt: u.last_sign_in_at ?? null,
        lastSeenAt: lastSeen.get(u.id) ?? null,
      });
    }
    if (data.users.length < 200) break;
    page += 1;
  }

  out.sort((a, b) => a.email.localeCompare(b.email));
  return out;
}

export async function updatePermisos(input: UpdatePermisosInput): Promise<UpdatePermisosResult> {
  const acceso = await autorizarAdmin();
  if (!acceso.ok) return { ok: false, error: acceso.error };

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Permisos inválidos" };
  }
  // Evita que un admin se quede fuera de esta misma pantalla.
  if (parsed.data.userId === acceso.userId && !parsed.data.esAdmin) {
    return { ok: false, error: "No puedes quitarte tu propio acceso de administrador." };
  }

  const { error } = await createAdminClient()
    .schema("core")
    .rpc("guardar_permisos", {
      p_user_id: parsed.data.userId,
      p_es_admin: parsed.data.esAdmin,
      p_permisos: parsed.data.procesos,
      p_otorgado_por: acceso.userId,
    });
  if (error) return { ok: false, error: error.message };

  revalidateTag("permisos", "max");
  return { ok: true };
}

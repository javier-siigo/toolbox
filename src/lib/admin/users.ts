"use server";

import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { z } from "zod";

import {
  getUserRoles,
  isAdmin,
  ALL_ROLES,
  KNOWN_PAISES,
  ROLE_ADMIN,
  ROLE_CONCILIACIONES,
} from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const updateSchema = z.object({
  userId: z.string().uuid("userId inválido"),
  roles: z.array(z.enum(ALL_ROLES)).default([]),
  paises: z.array(z.enum(KNOWN_PAISES)).default([]),
});

export type UpdateUserRolesInput = z.infer<typeof updateSchema>;

export type UpdateUserRolesResult =
  | { ok: true }
  | { ok: false; error: string };

async function requireCurrentAdmin(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub as string | undefined;
  if (!userId) redirect("/login");
  const roles = await getUserRoles(userId);
  if (!isAdmin(roles)) redirect("/");
  return userId;
}

export async function listUsersWithRoles(): Promise<
  {
    id: string;
    email: string;
    roles: string[];
    paises: string[];
    lastSignInAt: string | null;
    lastSeenAt: string | null;
  }[]
> {
  await requireCurrentAdmin();
  const admin = createAdminClient();

  const { data: rolesData, error: rolesError } = await admin
    .schema("core").from("user_roles")
    .select("user_id, roles, paises");
  if (rolesError) throw new Error(rolesError.message);

  const byUser = new Map<string, { roles: string[]; paises: string[] }>();
  for (const row of rolesData ?? []) {
    byUser.set(row.user_id as string, {
      roles: Array.isArray(row.roles) ? (row.roles as string[]) : [],
      paises: Array.isArray(row.paises) ? (row.paises as string[]) : [],
    });
  }

  const { data: activityData, error: activityError } = await admin
    .schema("core").from("user_activity")
    .select("user_id, last_seen_at");
  if (activityError) throw new Error(activityError.message);
  const lastSeen = new Map<string, string>(
    (activityData ?? []).map((row) => [row.user_id as string, row.last_seen_at as string]),
  );

  const seen = new Set<string>();
  const merged: {
    id: string;
    email: string;
    roles: string[];
    paises: string[];
    lastSignInAt: string | null;
    lastSeenAt: string | null;
  }[] = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    for (const u of data.users) {
      if (!u.email) continue;
      seen.add(u.id);
      const r = byUser.get(u.id) ?? { roles: [], paises: [] };
      merged.push({
        id: u.id,
        email: u.email,
        roles: r.roles,
        paises: r.paises,
        lastSignInAt: u.last_sign_in_at ?? null,
        lastSeenAt: lastSeen.get(u.id) ?? null,
      });
    }
    if (data.users.length < 200) break;
    page += 1;
  }

  for (const [userId, r] of byUser.entries()) {
    if (!seen.has(userId)) {
      merged.push({
        id: userId,
        email: "(usuario huérfano)",
        roles: r.roles,
        paises: r.paises,
        lastSignInAt: null,
        lastSeenAt: null,
      });
    }
  }

  merged.sort((a, b) => a.email.localeCompare(b.email));
  return merged;
}

export async function updateUserRoles(
  input: UpdateUserRolesInput,
): Promise<UpdateUserRolesResult> {
  const currentUserId = await requireCurrentAdmin();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        parsed.error.issues[0]?.message ?? "Datos de roles inválidos",
    };
  }

  const rolesSet = new Set(parsed.data.roles);
  // Evita que un admin se quede fuera de esta misma pantalla.
  if (parsed.data.userId === currentUserId && !rolesSet.has(ROLE_ADMIN)) {
    return { ok: false, error: "No puedes quitarte tu propio rol Admin." };
  }
  const paises =
    rolesSet.has(ROLE_CONCILIACIONES) ? parsed.data.paises : [];

  const admin = createAdminClient();
  const { error } = await admin
    .schema("core").from("user_roles")
    .upsert(
      {
        user_id: parsed.data.userId,
        roles: parsed.data.roles,
        paises,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) return { ok: false, error: error.message };

  revalidateTag("user-roles", "max");
  return { ok: true };
}
/**
 * Borra el registro de roles de un usuario que ya no existe en Auth.
 * Se niega si la cuenta sigue existiendo, para no usarlo como "quitar acceso".
 */
export async function deleteOrphanRoles(
  userId: string,
): Promise<UpdateUserRolesResult> {
  await requireCurrentAdmin();
  const parsed = z.string().uuid("userId inválido").safeParse(userId);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "userId inválido" };
  }

  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(parsed.data);
  if (data?.user) {
    return { ok: false, error: "El usuario tiene cuenta en Auth; quítale los roles en su lugar." };
  }

  const { error } = await admin.schema("core").from("user_roles").delete().eq("user_id", parsed.data);
  if (error) return { ok: false, error: error.message };

  revalidateTag("user-roles", "max");
  return { ok: true };
}

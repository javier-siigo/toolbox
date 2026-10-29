import "server-only";

import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Proceso } from "@/lib/navigation";

import {
  EMPTY_ROLES,
  isAdmin,
  hasRole,
  ROLE_INGRESOS,
  canAccessProceso,
  type UserRolesInfo,
} from "./roles-shared";

export {
  ROLE_ADMIN,
  ROLE_CONCILIACIONES,
  ROLE_INGRESOS,
  ALL_ROLES,
  KNOWN_PAISES,
  EMPTY_ROLES,
  isAdmin,
  hasRole,
  canAccessArea,
  canAccessProceso,
  filterAreas,
  type RoleName,
  type PaisCode,
  type UserRolesInfo,
} from "./roles-shared";

const fetchRoles = unstable_cache(
  async (userId: string): Promise<UserRolesInfo> => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("core").from("user_roles")
      .select("roles, paises")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return EMPTY_ROLES;
    return {
      roles: Array.isArray(data.roles) ? data.roles : [],
      paises: Array.isArray(data.paises) ? data.paises : [],
    };
  },
  ["user-roles"],
  { revalidate: 60, tags: ["user-roles"] },
);

export async function getUserRoles(userId: string): Promise<UserRolesInfo> {
  if (!userId) return EMPTY_ROLES;
  return fetchRoles(userId);
}

export async function requireAdmin(info: UserRolesInfo): Promise<void> {
  if (!isAdmin(info)) notFound();
}

export function hasIngresosOrAdmin(info: UserRolesInfo): boolean {
  if (isAdmin(info)) return true;
  return hasRole(info, ROLE_INGRESOS);
}

export async function requireProcesoAccess(
  info: UserRolesInfo,
  areaSlug: string,
  proceso: Pick<Proceso, "slug" | "flagCode" | "roles">,
): Promise<void> {
  if (!canAccessProceso(info, areaSlug, proceso)) notFound();
}
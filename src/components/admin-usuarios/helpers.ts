import { AREAS, type Area } from "@/lib/navigation";
import {
  NIVELES,
  NIVEL_META,
  filterAreas,
  type Nivel,
  type Permisos,
  type ProcesoId,
} from "@/lib/auth/permisos-shared";
import type { UsuarioConPermisos } from "@/lib/admin/users";

export type AdminUser = UsuarioConPermisos;

/** Lo que se edita en la hoja lateral: mismo formato que los permisos del servidor. */
export type Draft = Permisos;

export const EMPTY_DRAFT: Draft = { esAdmin: false, procesos: {} };

/** Áreas con procesos que tienen permisos propios (las que aparecen en el editor). */
export const AREAS_CON_PERMISOS: Area[] = AREAS.map((a) => ({
  ...a,
  procesos: a.procesos.filter((p) => p.id),
})).filter((a) => a.procesos.length > 0);

const NOMBRE_PROCESO = new Map<ProcesoId, string>(
  AREAS_CON_PERMISOS.flatMap((a) => a.procesos.map((p) => [p.id!, p.label] as const)),
);

export function nombreProceso(id: ProcesoId): string {
  return NOMBRE_PROCESO.get(id) ?? id;
}

const DAY = 86_400_000;

export function displayName(email: string) {
  return (email.split("@")[0] ?? email)
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function initials(email: string) {
  const parts = (email.split("@")[0] ?? "").split(/[._-]/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function relativeTime(iso: string | null) {
  if (!iso) return "Nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 60) return min <= 1 ? "Hace un momento" : `Hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return "Ayer";
  if (d < 30) return `Hace ${d} días`;
  const m = Math.round(d / 30);
  if (m < 12) return m === 1 ? "Hace 1 mes" : `Hace ${m} meses`;
  const y = Math.round(m / 12);
  return y === 1 ? "Hace 1 año" : `Hace ${y} años`;
}

export function absoluteTime(iso: string | null) {
  if (!iso) return undefined;
  return new Date(iso).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" });
}

/** Lo más reciente entre actividad registrada e inicio de sesión. */
export function lastActivity(user: Pick<AdminUser, "lastSeenAt" | "lastSignInAt">) {
  const { lastSeenAt: a, lastSignInAt: b } = user;
  if (!a || !b) return a ?? b;
  return new Date(a) > new Date(b) ? a : b;
}

export function isInactive(iso: string | null) {
  if (!iso) return true;
  return Date.now() - new Date(iso).getTime() > 30 * DAY;
}

/** Problemas de configuración que el admin debería resolver. */
export function issuesFor(d: Draft): string[] {
  if (d.esAdmin || Object.keys(d.procesos).length > 0) return [];
  return ["Sin permisos"];
}

export function accessFor(d: Draft) {
  return filterAreas(d, AREAS).filter((a) => a.slug !== "documentacion");
}

export function isDirty(initial: Draft, current: Draft) {
  if (initial.esAdmin !== current.esAdmin) return true;
  const ids = new Set([...Object.keys(initial.procesos), ...Object.keys(current.procesos)]) as Set<ProcesoId>;
  for (const id of ids) if (initial.procesos[id] !== current.procesos[id]) return true;
  return false;
}

export function diffLabels(initial: Draft, current: Draft) {
  const out: { sign: "+" | "−" | "~"; label: string }[] = [];
  if (!initial.esAdmin && current.esAdmin) out.push({ sign: "+", label: "Admin" });
  if (initial.esAdmin && !current.esAdmin) out.push({ sign: "−", label: "Admin" });
  const ids = new Set([...Object.keys(initial.procesos), ...Object.keys(current.procesos)]) as Set<ProcesoId>;
  for (const id of ids) {
    const antes = initial.procesos[id];
    const ahora = current.procesos[id];
    if (antes === ahora) continue;
    const nombre = nombreProceso(id);
    if (!antes) out.push({ sign: "+", label: `${nombre} · ${NIVEL_META[ahora!].label}` });
    else if (!ahora) out.push({ sign: "−", label: nombre });
    else out.push({ sign: "~", label: `${nombre}: ${NIVEL_META[antes].label} → ${NIVEL_META[ahora].label}` });
  }
  return out;
}

/** `null` quita el acceso al proceso. */
export function setNivel(d: Draft, proceso: ProcesoId, nivel: Nivel | null): Draft {
  const procesos = { ...d.procesos };
  if (nivel) procesos[proceso] = nivel;
  else delete procesos[proceso];
  return { ...d, procesos };
}

/** Atajo "toda el área": el mismo nivel (o ninguno) en todos sus procesos. */
export function setNivelArea(d: Draft, area: Area, nivel: Nivel | null): Draft {
  return area.procesos.reduce((acc, p) => setNivel(acc, p.id!, nivel), d);
}

/** Nivel común del área, `null` si ninguno tiene acceso, `"mixto"` si difieren. */
export function nivelArea(d: Draft, area: Area): Nivel | null | "mixto" {
  const niveles = new Set(area.procesos.map((p) => d.procesos[p.id!] ?? null));
  return niveles.size === 1 ? [...niveles][0]! : "mixto";
}

export { NIVELES, NIVEL_META };

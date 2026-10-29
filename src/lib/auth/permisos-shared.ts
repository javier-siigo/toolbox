import type { Area } from "@/lib/navigation";

/**
 * Permisos por proceso. Seguro para cliente y servidor: solo decide, no lee nada.
 *
 * La fuente de verdad es `core.permisos` (y `private.tiene_acceso` en RLS). Los ids de
 * `PROCESOS` deben existir en `core.procesos`; `npm run check:acceso` lo verifica.
 */

export const PROCESOS = {
  CONCILIACION_CHILE: "conciliaciones.chile",
  CONCILIACION_COLOMBIA: "conciliaciones.colombia",
  CONCILIACION_ECUADOR: "conciliaciones.ecuador",
  CONCILIACION_MEXICO: "conciliaciones.mexico",
  CONCILIACION_URUGUAY: "conciliaciones.uruguay",
  GESTION_ANTICIPOS: "ingresos.gestion-anticipos",
  NOTAS_CREDITO: "ingresos.notas-credito",
  CALCULO_COMISIONES: "ingresos.calculo-comisiones",
  EXPORT_BANCOS: "ingresos.export-bancos",
} as const;

export type ProcesoId = (typeof PROCESOS)[keyof typeof PROCESOS];

export const TODOS_LOS_PROCESOS = Object.values(PROCESOS) as ProcesoId[];

/** Conciliación de cada país: el país del body/URL decide qué proceso autorizar. */
export const CONCILIACION_POR_PAIS: Record<string, ProcesoId> = {
  CL: PROCESOS.CONCILIACION_CHILE,
  CO: PROCESOS.CONCILIACION_COLOMBIA,
  EC: PROCESOS.CONCILIACION_ECUADOR,
  MX: PROCESOS.CONCILIACION_MEXICO,
  UY: PROCESOS.CONCILIACION_URUGUAY,
};

/** En orden: cada nivel incluye a los anteriores. */
export const NIVELES = ["ver", "usar", "gestionar"] as const;
export type Nivel = (typeof NIVELES)[number];

export const NIVEL_META: Record<Nivel, { label: string; description: string }> = {
  ver: { label: "Ver", description: "Consulta y exporta, sin modificar nada." },
  usar: { label: "Usar", description: "Opera el proceso: crea, edita y ejecuta." },
  gestionar: { label: "Gestionar", description: "Además, configura el proceso." },
};

export interface Permisos {
  esAdmin: boolean;
  procesos: Partial<Record<ProcesoId, Nivel>>;
}

export const SIN_PERMISOS: Permisos = { esAdmin: false, procesos: {} };

export function esProcesoId(value: string): value is ProcesoId {
  return (TODOS_LOS_PROCESOS as string[]).includes(value);
}

export function esNivel(value: string): value is Nivel {
  return (NIVELES as readonly string[]).includes(value);
}

/** Nivel efectivo del usuario en el proceso (admin = gestionar en todo). */
export function nivelEn(p: Permisos, proceso: ProcesoId): Nivel | null {
  if (p.esAdmin) return "gestionar";
  return p.procesos[proceso] ?? null;
}

export function puede(p: Permisos, proceso: ProcesoId, nivel: Nivel = "ver"): boolean {
  const actual = nivelEn(p, proceso);
  return actual !== null && NIVELES.indexOf(actual) >= NIVELES.indexOf(nivel);
}

/** Acceso (cualquier nivel) a alguno de los procesos. Lista vacía: cualquier usuario con sesión. */
export function puedeAlguno(p: Permisos, requiere: readonly ProcesoId[]): boolean {
  return requiere.length === 0 || requiere.some((id) => puede(p, id));
}

/** Áreas y procesos visibles en el menú. Solo cosmético: la protección está en `acceso.ts` y RLS. */
export function filterAreas(p: Permisos, areas: Area[]): Area[] {
  if (p.esAdmin) return areas;
  return areas
    .map((area) => {
      if (area.slug === "admin") return null;
      const procesos = area.procesos.filter((proc) =>
        proc.id ? puede(p, proc.id) : puedeAlguno(p, proc.requiere ?? []),
      );
      if (procesos.length === 0) return null;
      return { ...area, procesos };
    })
    .filter((a): a is Area => a !== null);
}

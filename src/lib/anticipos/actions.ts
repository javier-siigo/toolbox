"use server";

import { revalidatePath } from "next/cache";

import { getUserRoles, hasIngresosOrAdmin } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_ANTICIPOS_ROWS,
  anticipoCreateSchema,
  anticipoIdSchema,
  anticipoUpdateSchema,
  type AnticipoCreateField,
  type AnticipoCreateInput,
  type AnticipoRow,
  type AnticipoUpdateField,
  type AnticipoUpdateInput,
} from "@/lib/anticipos/schema";

type RetiradoMatch = {
  query: string;
  cedula: number;
  nombre: string;
  valor: number | null;
  observacion: string | null;
  fecha_reporte: string;
  nivel: "exacto" | "exacto_inverso" | "parcial";
  tokens_comunes: string[] | null;
  tokens_extra: string[] | null;
};

function buildRetiroInfo(
  match: RetiradoMatch | null,
): AnticipoRow["retiro_info"] {
  if (!match) return null;
  return {
    cedula: match.cedula,
    nombre: match.nombre,
    valor: match.valor,
    observacion: match.observacion,
    fecha_reporte: match.fecha_reporte,
    nivel: match.nivel,
    tokensComunes: match.tokens_comunes ?? [],
    tokensExtra: match.tokens_extra ?? [],
  };
}

const SESION_EXPIRADA = "Tu sesión expiró. Vuelve a iniciar sesión.";
const SIN_PERMISOS = "No tienes permisos para gestionar anticipos.";

/**
 * Las server actions son un endpoint público: la autorización de la página
 * (`requireProcesoAccess`) no las cubre. Cada acción debe validar sesión y rol
 * aquí, y las políticas de RLS de `anticipos.registros` lo respaldan.
 */
async function requireIngresos() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, userId: null, error: SESION_EXPIRADA } as const;
  }
  const roles = await getUserRoles(user.id);
  if (!hasIngresosOrAdmin(roles)) {
    return { supabase, userId: null, error: SIN_PERMISOS } as const;
  }
  return { supabase, userId: user.id, error: null } as const;
}

export async function getAnticiposAll(): Promise<AnticipoRow[]> {
  const guard = await requireIngresos();
  if (guard.error) return [];
  const supabase = guard.supabase;

  const { data, error } = await supabase
    .schema("anticipos").from("registros")
    .select(
      "id, nombre, requerimiento, falta, observacion_1, observacion_2, fecha_rq, fecha_gestion, created_at, nombre_normalizado",
    )
    .order("created_at", { ascending: false })
    .limit(MAX_ANTICIPOS_ROWS);

  if (error) {
    throw new Error(`No se pudieron cargar los registros: ${error.message}`);
  }

  const rows = (data ?? []) as Array<
    Omit<AnticipoRow, "es_retirado" | "retiro_info"> & {
      nombre_normalizado: string | null;
    }
  >;

  const names = rows.map((r) => r.nombre).filter((n) => n.trim().length > 0);

  const matchesByQuery = new Map<string, RetiradoMatch>();
  if (names.length > 0) {
    const { data: matches, error: matchErr } = await supabase.schema("anticipos").rpc(
      "match_colaborador_retirado_batch",
      { p_inputs: names },
    );
    if (matchErr) {
      throw new Error(
        `No se pudo cruzar con excolaboradores: ${matchErr.message}`,
      );
    }
    for (const m of (matches ?? []) as RetiradoMatch[]) {
      matchesByQuery.set(m.query, m);
    }
  }

  return rows.map((r) => {
    const match = matchesByQuery.get(r.nombre) ?? null;
    return {
      id: r.id,
      nombre: r.nombre,
      requerimiento: r.requerimiento,
      falta: r.falta,
      observacion_1: r.observacion_1,
      observacion_2: r.observacion_2,
      fecha_rq: r.fecha_rq,
      fecha_gestion: r.fecha_gestion,
      created_at: r.created_at,
      es_retirado: Boolean(match),
      retiro_info: buildRetiroInfo(match),
    } satisfies AnticipoRow;
  });
}

export type CreateAnticipoState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<AnticipoCreateField, string>>;
};

export async function createAnticipo(
  _prev: CreateAnticipoState | undefined,
  formData: FormData,
): Promise<CreateAnticipoState> {
  const raw = {
    nombre: String(formData.get("nombre") ?? ""),
    requerimiento: String(formData.get("requerimiento") ?? ""),
    falta: String(formData.get("falta") ?? ""),
    observacion_1: String(formData.get("observacion_1") ?? ""),
    observacion_2: String(formData.get("observacion_2") ?? ""),
    fecha_rq: String(formData.get("fecha_rq") ?? ""),
    fecha_gestion: String(formData.get("fecha_gestion") ?? ""),
  };

  const parsed = anticipoCreateSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: CreateAnticipoState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        fieldErrors[key as AnticipoCreateField] = issue.message;
      }
    }
    return { error: "Revisa los campos marcados", fieldErrors };
  }

  const guard = await requireIngresos();
  if (guard.error) return { error: guard.error };
  const supabase = guard.supabase;
  const userId = guard.userId!;

  const payload: AnticipoCreateInput = parsed.data;

  const { error } = await supabase.schema("anticipos").from("registros").insert({
    nombre: payload.nombre,
    requerimiento: payload.requerimiento,
    falta: payload.falta,
    observacion_1: payload.observacion_1,
    observacion_2: payload.observacion_2 ? payload.observacion_2 : null,
    fecha_rq: payload.fecha_rq,
    fecha_gestion:
      payload.fecha_gestion === "" ? null : payload.fecha_gestion,
    created_by: userId,
    updated_by: userId,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        fieldErrors: {
          nombre: "Ya existe un registro para este colaborador y requerimiento.",
          requerimiento:
            "Ya existe un registro para este colaborador y requerimiento.",
        },
        error:
          "Ya existe un registro con este nombre y requerimiento. Revisa la tabla.",
      };
    }
    return { error: `No se pudo guardar el registro: ${error.message}` };
  }

  revalidatePath("/ingresos/gestion-anticipos");
  return { ok: true };
}

export type UpdateAnticipoState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<AnticipoUpdateField, string>>;
};

export async function updateAnticipo(
  _prev: UpdateAnticipoState | undefined,
  formData: FormData,
): Promise<UpdateAnticipoState> {
  const raw = {
    id: String(formData.get("id") ?? ""),
    nombre: String(formData.get("nombre") ?? ""),
    requerimiento: String(formData.get("requerimiento") ?? ""),
    falta: String(formData.get("falta") ?? ""),
    observacion_1: String(formData.get("observacion_1") ?? ""),
    observacion_2: String(formData.get("observacion_2") ?? ""),
    fecha_rq: String(formData.get("fecha_rq") ?? ""),
    fecha_gestion: String(formData.get("fecha_gestion") ?? ""),
  };

  const parsed = anticipoUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: UpdateAnticipoState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") {
        fieldErrors[key as AnticipoUpdateField] = issue.message;
      }
    }
    return { error: "Revisa los campos marcados", fieldErrors };
  }

  const guard = await requireIngresos();
  if (guard.error) return { error: guard.error };
  const supabase = guard.supabase;
  const userId = guard.userId!;

  const payload: AnticipoUpdateInput = parsed.data;

  const { error } = await supabase
    .schema("anticipos").from("registros")
    .update({
      nombre: payload.nombre,
      requerimiento: payload.requerimiento,
      falta: payload.falta,
      observacion_1: payload.observacion_1,
      observacion_2: payload.observacion_2 ? payload.observacion_2 : null,
      fecha_rq: payload.fecha_rq,
      fecha_gestion:
        payload.fecha_gestion === "" ? null : payload.fecha_gestion,
      updated_by: userId,
    })
    .eq("id", payload.id);

  if (error) {
    if (error.code === "23505") {
      return {
        fieldErrors: {
          nombre: "Ya existe un registro para este colaborador y requerimiento.",
          requerimiento:
            "Ya existe un registro para este colaborador y requerimiento.",
        },
        error:
          "Ya existe un registro con este nombre y requerimiento. Revisa la tabla.",
      };
    }
    return { error: `No se pudo actualizar el registro: ${error.message}` };
  }

  revalidatePath("/ingresos/gestion-anticipos");
  return { ok: true };
}

export type DeleteAnticipoState = {
  ok?: boolean;
  error?: string;
};

export async function deleteAnticipo(
  id: string,
): Promise<DeleteAnticipoState> {
  const parsed = anticipoIdSchema.safeParse({ id });
  if (!parsed.success) {
    return { error: "Identificador inválido." };
  }

  const guard = await requireIngresos();
  if (guard.error) return { error: guard.error };
  const supabase = guard.supabase;

  const { error } = await supabase
    .schema("anticipos").from("registros")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    return { error: `No se pudo eliminar el registro: ${error.message}` };
  }

  revalidatePath("/ingresos/gestion-anticipos");
  return { ok: true };
}

export type LegalizeAnticipoState = {
  ok?: boolean;
  error?: string;
};

export async function legalizeAnticipo(
  id: string,
): Promise<LegalizeAnticipoState> {
  const parsed = anticipoIdSchema.safeParse({ id });
  if (!parsed.success) {
    return { error: "Identificador inválido." };
  }

  const guard = await requireIngresos();
  if (guard.error) return { error: guard.error };
  const supabase = guard.supabase;
  const userId = guard.userId!;

  const { error } = await supabase
    .schema("anticipos").from("registros")
    .update({
      falta: "legalizado",
      observacion_1: "legalizado",
      updated_by: userId,
    })
    .eq("id", parsed.data.id);

  if (error) {
    return { error: `No se pudo legalizar el registro: ${error.message}` };
  }

  revalidatePath("/ingresos/gestion-anticipos");
  return { ok: true };
}

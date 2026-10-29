"use server";

import { revalidatePath } from "next/cache";

import { autorizar } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
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

const REGISTRO_COLUMNS =
  "id, nombre, requerimiento, falta, observacion_1, observacion_2, fecha_rq, fecha_gestion, created_at, es_retirado, retiro_nivel, retiro_tokens_comunes, retiro_tokens_extra, retirado:retirados(cedula, nombre, valor, observacion, fecha_reporte)";

/**
 * El cruce con excolaboradores ya viene calculado en cada registro (triggers en la BD:
 * al insertar/renombrar un registro y al importar excolaboradores), así que la carga es
 * una sola consulta.
 */
export async function getAnticiposAll(): Promise<AnticipoRow[]> {
  const acceso = await autorizar(PROCESOS.GESTION_ANTICIPOS, "ver");
  if (!acceso.ok) return [];
  const { supabase } = acceso;

  const { data, error } = await supabase
    .schema("anticipos").from("registros")
    .select(REGISTRO_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(MAX_ANTICIPOS_ROWS);

  if (error) {
    throw new Error(`No se pudieron cargar los registros: ${error.message}`);
  }

  return (data ?? []).map((r) => {
    const { retirado, retiro_nivel, retiro_tokens_comunes, retiro_tokens_extra, ...rest } = r;
    return {
      ...rest,
      es_retirado: Boolean(retirado),
      retiro_info:
        retirado && retiro_nivel
          ? {
              cedula: retirado.cedula,
              nombre: retirado.nombre,
              valor: retirado.valor,
              observacion: retirado.observacion,
              fecha_reporte: retirado.fecha_reporte,
              nivel: retiro_nivel as NonNullable<AnticipoRow["retiro_info"]>["nivel"],
              tokensComunes: retiro_tokens_comunes ?? [],
              tokensExtra: retiro_tokens_extra ?? [],
            }
          : null,
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

  const acceso = await autorizar(PROCESOS.GESTION_ANTICIPOS, "usar");
  if (!acceso.ok) return { error: acceso.error };
  const { supabase, userId } = acceso;

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

  revalidatePath("/ingresos-egresos/gestion-anticipos");
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

  const acceso = await autorizar(PROCESOS.GESTION_ANTICIPOS, "usar");
  if (!acceso.ok) return { error: acceso.error };
  const { supabase, userId } = acceso;

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

  revalidatePath("/ingresos-egresos/gestion-anticipos");
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

  const acceso = await autorizar(PROCESOS.GESTION_ANTICIPOS, "usar");
  if (!acceso.ok) return { error: acceso.error };
  const { supabase } = acceso;

  const { error } = await supabase
    .schema("anticipos").from("registros")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    return { error: `No se pudo eliminar el registro: ${error.message}` };
  }

  revalidatePath("/ingresos-egresos/gestion-anticipos");
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

  const acceso = await autorizar(PROCESOS.GESTION_ANTICIPOS, "usar");
  if (!acceso.ok) return { error: acceso.error };
  const { supabase, userId } = acceso;

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

  revalidatePath("/ingresos-egresos/gestion-anticipos");
  return { ok: true };
}

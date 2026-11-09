"use server";

import { revalidatePath, updateTag } from "next/cache";

import { autorizar } from "@/lib/auth/acceso";
import { CONCILIACION_POR_PAIS } from "@/lib/auth/permisos-shared";
import { createAdminClient } from "@/lib/supabase/admin";

import { validarPeriodo } from "./periodo";

const RUTA_POR_PAIS: Record<string, string> = {
  CO: "/conciliaciones/colombia",
  MX: "/conciliaciones/mexico",
  UY: "/conciliaciones/uruguay",
  EC: "/conciliaciones/ecuador",
  CL: "/conciliaciones/chile",
};

export type ResultadoPeriodo = { ok: true } | { ok: false; error: string };

/**
 * Los contadores (nivel `usar` en la conciliación del país) definen el mes que se
 * concilia en el banco y hasta qué día se sigue trabajando ese mes.
 */
export async function guardarPeriodoBanco(input: {
  pais: string;
  banco: string;
  mes: string;
  cierre: string;
}): Promise<ResultadoPeriodo> {
  const proceso = CONCILIACION_POR_PAIS[input.pais];
  if (!proceso) return { ok: false, error: "País no válido." };
  const acceso = await autorizar(proceso, "usar");
  if (!acceso.ok) return { ok: false, error: acceso.error };

  const invalido = validarPeriodo(input.mes, input.cierre);
  if (invalido) return { ok: false, error: invalido };

  // La tabla solo tiene política de lectura: se escribe con el cliente admin tras autorizar.
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("conciliaciones").from("bancos")
    .update({
      periodo: `${input.mes}-01`,
      periodo_cierre: input.cierre,
      periodo_actualizado_por: acceso.userId,
      periodo_actualizado_en: new Date().toISOString(),
    })
    .eq("pais", input.pais)
    .eq("slug", input.banco)
    .eq("activo", true)
    .select("slug");

  if (error) {
    console.error("[conciliaciones] guardarPeriodoBanco", error);
    return { ok: false, error: "No se pudo guardar el periodo. Intenta de nuevo." };
  }
  if (!data || data.length === 0) return { ok: false, error: "El banco no está disponible." };

  updateTag("conciliacion-bancos");
  const ruta = RUTA_POR_PAIS[input.pais];
  if (ruta) revalidatePath(ruta);
  return { ok: true };
}

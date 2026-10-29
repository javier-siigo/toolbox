"use server";

import { revalidatePath } from "next/cache";

import { autorizar } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { importRetiradosXlsx } from "@/lib/retirados/import";

export type ImportarRetiradosState = {
  ok?: boolean;
  error?: string;
  fileName?: string;
  total?: number;
  upserted?: number;
  errors?: number;
};

export async function importarRetiradosAction(
  _prev: ImportarRetiradosState | undefined,
  formData: FormData,
): Promise<ImportarRetiradosState> {
  const acceso = await autorizar(PROCESOS.GESTION_ANTICIPOS, "usar");
  if (!acceso.ok) return { error: acceso.error };
  const { userId } = acceso;

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "Selecciona un archivo de Excel." };
  }

  const admin = createAdminClient();
  const result = await importRetiradosXlsx(admin, file, userId);
  if (!result.ok) {
    return { error: result.error };
  }

  revalidatePath("/ingresos-egresos/gestion-anticipos");
  revalidatePath("/admin/importar-retirados");

  return {
    ok: true,
    fileName: result.fileName,
    total: result.total,
    upserted: result.upserted,
    errors: result.errors,
  };
}

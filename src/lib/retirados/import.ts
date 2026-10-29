import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";

export type Retirado = {
  cedula: number;
  nombre: string;
  valor: number | null;
  observacion: string | null;
};

export type ImportRetiradosResult =
  | {
      ok: true;
      fileName: string;
      fileSize: number;
      total: number;
      upserted: number;
      errors: number;
    }
  | { ok: false; error: string };

const UPSERT_BATCH = 100;
const ALLOWED_EXTENSIONS = /\.(xlsx|xls)$/i;
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export function parseRetiradosXlsx(buffer: ArrayBuffer): Retirado[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) {
    throw new Error("El archivo no contiene hojas.");
  }
  const ws = wb.Sheets[firstSheet];
  if (!ws) {
    throw new Error("No se pudo leer la primera hoja del archivo.");
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
  });
  const out: Retirado[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    const cedulaRaw = r[0];
    const nombreRaw = r[1];
    const valorRaw = r[3];
    const observacionRaw = r[4];

    if (cedulaRaw == null || nombreRaw == null) continue;
    const cedula = Number(cedulaRaw);
    if (!Number.isFinite(cedula) || cedula <= 0) continue;
    const nombre = String(nombreRaw).trim();
    if (!nombre) continue;

    const valorNum =
      valorRaw == null || valorRaw === "" || valorRaw === "Si"
        ? null
        : Number(valorRaw);
    const valor = Number.isFinite(valorNum) ? valorNum : null;
    const observacion =
      observacionRaw == null || observacionRaw === ""
        ? null
        : String(observacionRaw).trim();

    out.push({ cedula, nombre, valor, observacion });
  }
  return out;
}

async function upsertRetirados(
  supabase: SupabaseClient<Database>,
  rows: Retirado[],
): Promise<{ upserted: number; errors: number }> {
  let upserted = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows
      .slice(i, i + UPSERT_BATCH)
      .map((r) => ({
        cedula: r.cedula,
        nombre: r.nombre,
        valor: r.valor,
        observacion: r.observacion,
      }));
    const { error } = await supabase
      .schema("anticipos").from("retirados")
      .upsert(batch, { onConflict: "cedula", ignoreDuplicates: false });
    if (error) {
      errors += batch.length;
    } else {
      upserted += batch.length;
    }
  }
  return { upserted, errors };
}

export async function importRetiradosXlsx(
  supabase: SupabaseClient<Database>,
  file: File,
  importedBy?: string,
): Promise<ImportRetiradosResult> {
  if (!file.name || !ALLOWED_EXTENSIONS.test(file.name)) {
    return { ok: false, error: "Solo se aceptan archivos .xlsx o .xls." };
  }
  if (file.size <= 0) {
    return { ok: false, error: "El archivo está vacío." };
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      ok: false,
      error: `El archivo supera el límite de ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
    };
  }

  let rows: Retirado[];
  try {
    const buffer = await file.arrayBuffer();
    rows = parseRetiradosXlsx(buffer);
  } catch (e) {
    return {
      ok: false,
      error: `No se pudo leer el archivo: ${(e as Error).message}`,
    };
  }

  if (rows.length === 0) {
    return {
      ok: false,
      error:
        "El archivo no contiene filas válidas (se esperan columnas CEDULA, NOMBRE, TIENE ANTICIPO, VALOR, OBSERVACION).",
    };
  }

  const { upserted, errors } = await upsertRetirados(supabase, rows);

  await supabase.schema("anticipos").from("retirados_imports").insert({
    file_name: file.name,
    file_size: file.size,
    total_rows: rows.length,
    upserted,
    errors,
    imported_by: importedBy ?? null,
  });

  return {
    ok: true,
    fileName: file.name,
    fileSize: file.size,
    total: rows.length,
    upserted,
    errors,
  };
}

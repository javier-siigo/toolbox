import { NextResponse } from "next/server";

import { autorizar, respuestaDenegada } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { rutaEntrada, validarArchivoAsientos, type KindAsientos } from "@/lib/conciliaciones/asientos";
import { BUCKET, ConciliacionError } from "@/lib/conciliaciones/conciliar";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const KINDS: readonly KindAsientos[] = ["balance", "asientos"];

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/** URL firmada para subir el balance o los asientos directo a Storage. */
export async function POST(request: Request) {
  const acceso = await autorizar(PROCESOS.CONCILIACION_ASIENTOS, "usar");
  if (!acceso.ok) return respuestaDenegada(acceso);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind;
  const filename = body?.filename;
  const size = body?.size;
  if (typeof kind !== "string" || !KINDS.includes(kind as KindAsientos)) {
    return jsonError("Tipo de archivo inválido.", "bad_request", 400);
  }
  if (typeof filename !== "string" || !filename || typeof size !== "number" || !Number.isFinite(size)) {
    return jsonError("Falta el nombre o el tamaño del archivo.", "bad_request", 400);
  }
  try {
    validarArchivoAsientos(kind as KindAsientos, filename, size);
  } catch (err) {
    if (err instanceof ConciliacionError) return jsonError(err.message, err.code, err.status);
    throw err;
  }

  const path = rutaEntrada(acceso.userId, kind as KindAsientos, filename);
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[asientos/upload-url]", error?.message);
    return jsonError("No se pudo preparar la subida. Intenta de nuevo.", "upload_failed", 500);
  }
  return NextResponse.json({ url: data.signedUrl, path: data.path });
}

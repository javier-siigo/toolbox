import { NextResponse } from "next/server";

import { autorizar, respuestaDenegada } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIME_PREFIXES,
  MAX_FILE_SIZE_BYTES,
} from "@/lib/notas-credito/conciliar";

const BUCKET = "notas-credito-uploads";
const URL_TTL_SECONDS = 60 * 5;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildStoragePath(userId: string, extension: string): string {
  const safeExt = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${userId}/${id}.${safeExt}`;
}

export const runtime = "nodejs";

export async function POST(request: Request) {
  const acceso = await autorizar(PROCESOS.NOTAS_CREDITO, "usar");
  if (!acceso.ok) return respuestaDenegada(acceso);
  const { userId } = acceso;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(
      "Cuerpo inválido: se esperaba JSON",
      "bad_request",
      400,
    );
  }

  if (!isPlainObject(body)) {
    return jsonError("Cuerpo inválido: se esperaba un objeto", "bad_request", 400);
  }

  const { filename, contentType, size } = body;

  if (typeof filename !== "string" || filename.length === 0) {
    return jsonError("Falta el nombre del archivo", "bad_request", 400);
  }
  if (typeof contentType !== "string" || contentType.length === 0) {
    return jsonError("Falta el tipo de archivo", "bad_request", 400);
  }
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    return jsonError("Tamaño de archivo inválido", "bad_request", 400);
  }

  if (size > MAX_FILE_SIZE_BYTES) {
    return jsonError("El archivo supera el límite de 10 MB.", "file_too_large", 413);
  }

  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const mimeOk = ACCEPTED_MIME_PREFIXES.some((p) => contentType.startsWith(p));
  const extOk = (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension);
  if (!mimeOk && !extOk) {
    return jsonError(
      "Tipo de archivo no soportado. Usa .xlsx, .xls o .csv.",
      "invalid_type",
      415,
    );
  }

  const path = buildStoragePath(userId, extension);
  const admin = createAdminClient();

  const { data: signed, error: signedError } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (signedError || !signed) {
    return jsonError(
      "No se pudo preparar la subida. Intenta de nuevo.",
      "upload_failed",
      500,
    );
  }

  return NextResponse.json({
    url: signed.signedUrl,
    path: signed.path,
    token: signed.token,
    bucket: BUCKET,
    expiresIn: URL_TTL_SECONDS,
  });
}

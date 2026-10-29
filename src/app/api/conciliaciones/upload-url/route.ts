import { NextResponse } from "next/server";

import { BUCKET } from "@/lib/conciliaciones/conciliar";
import { autorizar, respuestaDenegada } from "@/lib/auth/acceso";
import { CONCILIACION_POR_PAIS } from "@/lib/auth/permisos-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIME_PREFIXES,
  MAX_FILE_SIZE_BYTES,
  PREVIO_INVALID_TYPE_MESSAGE,
  isXlsxFilename,
} from "@/lib/uploads";

const URL_TTL_SECONDS = 60 * 5;
const ALLOWED_KINDS = ["principal", "previo"] as const;
type UploadKind = (typeof ALLOWED_KINDS)[number];

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeUserId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function buildStoragePath(userId: string, kind: UploadKind, extension: string): string {
  const safeExt = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${safeUserId(userId)}/${kind}/${id}.${safeExt}`;
}

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Cuerpo inválido: se esperaba JSON", "bad_request", 400);
  }
  if (!isPlainObject(body)) {
    return jsonError("Cuerpo inválido: se esperaba un objeto", "bad_request", 400);
  }

  const { pais, kind, filename, contentType, size } = body;

  if (typeof pais !== "string" || pais.length === 0) {
    return jsonError("Falta el país", "bad_request", 400);
  }
  const proceso = CONCILIACION_POR_PAIS[pais];
  if (!proceso) return jsonError("País no válido", "bad_request", 400);
  const acceso = await autorizar(proceso, "usar");
  if (!acceso.ok) return respuestaDenegada(acceso);
  const userId = acceso.userId;
  if (typeof kind !== "string" || !ALLOWED_KINDS.includes(kind as UploadKind)) {
    return jsonError(
      `Tipo de archivo inválido (debe ser ${ALLOWED_KINDS.join(" o ")})`,
      "bad_request",
      400,
    );
  }
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
  if (kind === "previo" && !isXlsxFilename(filename)) {
    return jsonError(PREVIO_INVALID_TYPE_MESSAGE, "invalid_type", 415);
  }

  const path = buildStoragePath(userId, kind as UploadKind, extension);
  const admin = createAdminClient();

  let signed: { signedUrl: string; path: string; token: string } | null = null;
  let signedError: { message?: string } | null = null;
  try {
    const result = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    signed = result.data;
    signedError = result.error;
  } catch (err) {
    console.error("[conciliaciones/upload-url] storage error", { path, err });
    return jsonError(
      "No se pudo preparar la subida. Intenta de nuevo.",
      "upload_failed",
      500,
    );
  }

  if (signedError || !signed) {
    console.error("[conciliaciones/upload-url] signed url error", {
      path,
      message: signedError?.message,
    });
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

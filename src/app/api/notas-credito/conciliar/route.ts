import { NextResponse } from "next/server";

import { autorizar, respuestaDenegada } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIME_PREFIXES,
  ConciliarError,
  MAX_FILE_SIZE_BYTES,
  conciliarNotasCredito,
} from "@/lib/notas-credito/conciliar";
import { highlightNegativeDifferences } from "@/lib/notas-credito/highlight-differences";

const BUCKET = "notas-credito-uploads";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildStorageFilename(originalName: string): string {
  const safe = originalName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return safe || "resultado.xlsx";
}

function isUserStoragePath(path: string, userId: string): boolean {
  return new RegExp(`^${userId}/[^/]+$`).test(path);
}

export async function POST(request: Request) {
  const acceso = await autorizar(PROCESOS.NOTAS_CREDITO, "usar");
  if (!acceso.ok) return respuestaDenegada(acceso);
  const { userId } = acceso;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Cuerpo inválido: se esperaba JSON", "bad_request", 400);
  }

  if (!isPlainObject(body)) {
    return jsonError("Cuerpo inválido: se esperaba un objeto", "bad_request", 400);
  }

  const { storagePath, originalName } = body;
  if (typeof storagePath !== "string" || storagePath.length === 0) {
    return jsonError("Falta la ruta del archivo subido", "missing_file", 400);
  }
  if (!isUserStoragePath(storagePath, userId)) {
    return jsonError(
      "No tienes acceso a este archivo.",
      "storage_unauthorized",
      403,
    );
  }

  const admin = createAdminClient();

  let blob: Blob;
  try {
    const result = await admin.storage.from(BUCKET).download(storagePath);
    if (result.error || !result.data) {
      const isNotFound =
        result.error?.message?.toLowerCase().includes("not found") ?? false;
      return jsonError(
        isNotFound
          ? "El archivo subido ya no está disponible. Súbelo de nuevo."
          : "No se pudo leer el archivo subido.",
        isNotFound ? "storage_not_found" : "internal",
        isNotFound ? 404 : 500,
      );
    }
    blob = result.data;
  } catch {
    return jsonError(
      "No se pudo contactar el servicio de almacenamiento.",
      "upstream_network",
      502,
    );
  }

  if (blob.size === 0) {
    void admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return jsonError("El archivo subido está vacío.", "missing_file", 400);
  }
  if (blob.size > MAX_FILE_SIZE_BYTES) {
    void admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return jsonError("El archivo supera el límite de 10 MB.", "file_too_large", 413);
  }

  const filename = typeof originalName === "string" ? originalName : storagePath.split("/").pop() ?? "archivo";
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const mimeOk = ACCEPTED_MIME_PREFIXES.some((p) => blob.type.startsWith(p));
  const extOk = (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension);
  if (!mimeOk && !extOk) {
    void admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return jsonError(
      "Tipo de archivo no soportado. Usa .xlsx, .xls o .csv.",
      "invalid_type",
      415,
    );
  }

  const safeFilename = buildStorageFilename(filename);
  const file = new File([blob], safeFilename, { type: blob.type });

  try {
    const result = await conciliarNotasCredito(file);
    const arrayBuffer = await result.blob.arrayBuffer();

    let responseBuffer = arrayBuffer;
    try {
      const highlighted = await highlightNegativeDifferences(arrayBuffer);
      responseBuffer = highlighted.buffer;
      if (highlighted.summary.highlightedRows > 0) {
        console.info(
          `[notas-credito] Filas con diferencia negativa resaltadas: ${highlighted.summary.highlightedRows} (hojas: ${highlighted.summary.sheetsProcessed})`,
        );
      }
    } catch (highlightErr) {
      console.error(
        "[notas-credito] No se pudo resaltar filas con diferencia negativa; se devuelve el archivo sin modificar.",
        highlightErr,
      );
    }

    void admin.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    return new Response(responseBuffer, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ConciliarError) {
      const message =
        err.code === "upstream_status" && err.status >= 500
          ? "El servicio de conciliación no está disponible. Intenta de nuevo."
          : err.code === "upstream_timeout"
            ? "La conciliación tardó demasiado. Intenta con un archivo más pequeño."
            : err.code === "upstream_empty"
              ? "El servicio devolvió un archivo vacío."
              : err.message;
      return NextResponse.json(
        { error: message, code: err.code, storagePath },
        { status: err.status },
      );
    }
    return NextResponse.json(
      {
        error: "Error inesperado al conciliar",
        code: "internal",
        storagePath,
      },
      { status: 500 },
    );
  }
}

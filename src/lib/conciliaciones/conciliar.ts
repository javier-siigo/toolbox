import "server-only";

import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PeriodoVigente } from "./periodo";
import { appendPeriodo } from "./periodo";
import { ACCEPTED_EXTENSIONS, ACCEPTED_MIME_PREFIXES, MAX_FILE_SIZE_BYTES } from "@/lib/uploads";

export const BUCKET = "conciliaciones-uploads";

export type ConciliacionErrorCode =
  | "missing_file"
  | "invalid_type"
  | "file_too_large"
  | "storage_unauthorized"
  | "storage_not_found"
  | "upstream_config"
  | "upstream_timeout"
  | "upstream_network"
  | "upstream_status"
  | "upstream_empty";

export class ConciliacionError extends Error {
  code: ConciliacionErrorCode;
  status: number;

  constructor(message: string, code: ConciliacionErrorCode, status: number) {
    super(message);
    this.name = "ConciliacionError";
    this.code = code;
    this.status = status;
  }
}

export interface ConciliacionResult {
  blob: Blob;
  filename: string;
  contentType: string;
  registrosNuevos: number | null;
  registrosExistentes: number | null;
  /** Registros descartados por tener fecha fuera del periodo (si n8n lo informa). */
  registrosFueraPeriodo: number | null;
}

export interface InputFile {
  storagePath: string;
  originalName: string;
}

// Algunos bancos tardan varios minutos en n8n. Queda por debajo del
// maxDuration (300 s) de la ruta para devolver un error claro en vez del 504 de Vercel.
const REQUEST_TIMEOUT_MS = 280_000;
const FALLBACK_FILENAME = "resultado_conciliacion.xlsx";
const FALLBACK_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function validateFileMeta(filename: string, size: number, contentType: string): void {
  if (size <= 0) {
    throw new ConciliacionError("El archivo está vacío.", "missing_file", 400);
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    throw new ConciliacionError(
      "El archivo supera el límite de 10 MB.",
      "file_too_large",
      413,
    );
  }
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  const mimeOk = ACCEPTED_MIME_PREFIXES.some((p) => contentType.startsWith(p));
  const extOk = (ACCEPTED_EXTENSIONS as readonly string[]).includes(extension);
  if (!mimeOk && !extOk) {
    throw new ConciliacionError(
      "Tipo de archivo no soportado. Usa .xlsx, .xls o .csv.",
      "invalid_type",
      415,
    );
  }
}

function extractFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return FALLBACK_FILENAME;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      return FALLBACK_FILENAME;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(contentDisposition)?.[1];
  return plain?.trim() || FALLBACK_FILENAME;
}

function parseCount(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildStorageFilename(originalName: string): string {
  const safe = originalName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return safe || "archivo";
}

interface DownloadResult {
  file: File;
  meta: { storagePath: string; originalName: string };
}

async function downloadFromStorage(
  storagePath: string,
  originalName: string,
): Promise<DownloadResult> {
  const admin = createAdminClient();
  const result = await admin.storage.from(BUCKET).download(storagePath);
  if (result.error || !result.data) {
    const isNotFound =
      result.error?.message?.toLowerCase().includes("not found") ?? false;
    throw new ConciliacionError(
      isNotFound
        ? "El archivo subido ya no está disponible. Súbelo de nuevo."
        : "No se pudo leer el archivo subido.",
      isNotFound ? "storage_not_found" : "storage_unauthorized",
      isNotFound ? 404 : 403,
    );
  }
  const blob = result.data;
  if (blob.size === 0) {
    throw new ConciliacionError("El archivo subido está vacío.", "missing_file", 400);
  }
  validateFileMeta(originalName, blob.size, blob.type);
  const filename = buildStorageFilename(originalName);
  const file = new File([blob], filename, { type: blob.type });
  return { file, meta: { storagePath, originalName } };
}

export interface ConciliarArgs {
  webhookUrl: string;
  pais: string;
  banco: string;
  bancoNombre: string;
  periodo: PeriodoVigente;
  principal: InputFile;
  previo?: InputFile;
}

export async function conciliarColombia(args: ConciliarArgs): Promise<ConciliacionResult> {
  const env = serverEnv();
  if (!args.webhookUrl) {
    throw new ConciliacionError(
      "Falta la URL del webhook para el banco seleccionado.",
      "upstream_config",
      500,
    );
  }

  const principalFile = await downloadFromStorage(
    args.principal.storagePath,
    args.principal.originalName,
  );
  const previoFile = args.previo
    ? await downloadFromStorage(args.previo.storagePath, args.previo.originalName)
    : null;

  const formData = new FormData();
  formData.append("pais", args.pais);
  formData.append("banco", args.banco);
  formData.append("bancoNombre", args.bancoNombre);
  appendPeriodo(formData, args.periodo);
  formData.append("file", principalFile.file, principalFile.file.name);
  if (previoFile) {
    formData.append("previous", previoFile.file, previoFile.file.name);
  }

  const headers: Record<string, string> = {};
  if (env.N8N_WEBHOOK_SECRET) {
    headers["x-webhook-secret"] = env.N8N_WEBHOOK_SECRET;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(args.webhookUrl, {
      method: "POST",
      headers,
      body: formData,
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new ConciliacionError(
        `n8n respondió ${response.status}`,
        "upstream_status",
        response.status,
      );
    }

    const blob = await response.blob();
    if (blob.size === 0) {
      throw new ConciliacionError(
        "n8n devolvió una respuesta vacía",
        "upstream_empty",
        502,
      );
    }

    return {
      blob,
      filename: extractFilename(response.headers.get("content-disposition")),
      contentType:
        response.headers.get("content-type")?.split(";")[0]?.trim() ||
        FALLBACK_CONTENT_TYPE,
      registrosNuevos: parseCount(response.headers.get("x-registros-nuevos")),
      registrosExistentes: parseCount(response.headers.get("x-registros-existentes")),
      registrosFueraPeriodo: parseCount(response.headers.get("x-registros-fuera-periodo")),
    };
  } catch (err) {
    if (err instanceof ConciliacionError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new ConciliacionError(
        "Tiempo de espera agotado al llamar a n8n",
        "upstream_timeout",
        504,
      );
    }
    throw new ConciliacionError(
      `No se pudo contactar a n8n: ${(err as Error).message}`,
      "upstream_network",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function cleanupStorage(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const admin = createAdminClient();
    await admin.storage.from(BUCKET).remove(paths);
  } catch {
    // best-effort
  }
}

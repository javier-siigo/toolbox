import "server-only";

import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PeriodoVigente } from "./periodo";
import { appendPeriodo } from "./periodo";
import { esArchivoDomiciliacion } from "./particularidades";
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

// n8n responde 202 en cuanto recibe los archivos; la conciliación sigue en segundo plano
// (n8n Cloud corta en 100 s cualquier respuesta de webhook).
const REQUEST_TIMEOUT_MS = 60_000;
const FALLBACK_FILENAME = "resultado_conciliacion.xlsx";
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function safeUserId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Dónde deja n8n el resultado de un trabajo: el Excel y su estado (`{ ok, ... }`). */
export function rutasResultado(userId: string, jobId: string) {
  const base = `${safeUserId(userId)}/resultado/${jobId}`;
  return { excel: `${base}.xlsx`, estado: `${base}.json` };
}

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

function parseCount(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
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

/** TXT de domiciliación: mismo límite de tamaño, solo .dom / .txt. */
function validateDomiciliacionMeta(filename: string, size: number): void {
  if (size <= 0) {
    throw new ConciliacionError(`El TXT ${filename} está vacío.`, "missing_file", 400);
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    throw new ConciliacionError(`El TXT ${filename} supera el límite de 10 MB.`, "file_too_large", 413);
  }
  if (!esArchivoDomiciliacion(filename)) {
    throw new ConciliacionError(
      `${filename} no es un TXT de domiciliación (.dom o .txt).`,
      "invalid_type",
      415,
    );
  }
}

async function downloadFromStorage(
  storagePath: string,
  originalName: string,
  validar: (filename: string, size: number, contentType: string) => void = validateFileMeta,
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
  validar(originalName, blob.size, blob.type);
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
  /** TXT diarios de domiciliación (solo bancos con `getDomiciliacion`). */
  domiciliacion?: InputFile[];
  /** Dueño del trabajo: el resultado queda bajo su carpeta. */
  userId: string;
  jobId: string;
}

async function urlSubidaFirmada(path: string): Promise<string> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    throw new ConciliacionError(
      "No se pudo preparar dónde guardar el resultado.",
      "upstream_config",
      500,
    );
  }
  return data.signedUrl;
}

/**
 * Envía los archivos a n8n y vuelve en cuanto n8n confirma que los recibió (202).
 * n8n sube el Excel y su estado a `rutasResultado(userId, jobId)`; se leen con `leerResultado`.
 */
export async function iniciarConciliacion(args: ConciliarArgs): Promise<void> {
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
  const domiciliacionFiles = [];
  for (const d of args.domiciliacion ?? []) {
    domiciliacionFiles.push(
      await downloadFromStorage(d.storagePath, d.originalName, validateDomiciliacionMeta),
    );
  }

  const formData = new FormData();
  formData.append("pais", args.pais);
  formData.append("banco", args.banco);
  formData.append("bancoNombre", args.bancoNombre);
  appendPeriodo(formData, args.periodo);
  formData.append("file", principalFile.file, principalFile.file.name);
  if (previoFile) {
    formData.append("previous", previoFile.file, previoFile.file.name);
  }
  // n8n (Classify Files) los toma por la regla `domiciliacion` de bank_registry.archivos.
  domiciliacionFiles.forEach((d, i) => {
    formData.append(`domiciliacion_${i}`, d.file, d.file.name);
  });
  const rutas = rutasResultado(args.userId, args.jobId);
  formData.append("resultUploadUrl", await urlSubidaFirmada(rutas.excel));
  formData.append("statusUploadUrl", await urlSubidaFirmada(rutas.estado));

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

    // 202 = recibido. Un 200 sería el flujo síncrono viejo (no manda resultado a Storage).
    if (response.status !== 202) {
      throw new ConciliacionError(
        `n8n respondió ${response.status}`,
        "upstream_status",
        response.ok ? 502 : response.status,
      );
    }
    await response.body?.cancel();
  } catch (err) {
    if (err instanceof ConciliacionError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new ConciliacionError(
        "n8n no confirmó la recepción de los archivos",
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

/** Descarga un archivo del bucket; null si todavía no existe. */
async function descargarSiExiste(path: string): Promise<Blob | null> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(path);
  if (data) return data;
  const msg = `${error?.message ?? ""} ${(error as { status?: number } | null)?.status ?? ""}`.toLowerCase();
  if (msg.includes("not found") || msg.includes("400") || msg.includes("404")) return null;
  throw new ConciliacionError("No se pudo leer el resultado.", "storage_unauthorized", 502);
}

/**
 * Resultado de un trabajo: null mientras n8n no termine. Lanza ConciliacionError si n8n
 * informó un error. Borra los archivos del resultado una vez leídos.
 */
export async function leerResultado(userId: string, jobId: string): Promise<ConciliacionResult | null> {
  const rutas = rutasResultado(userId, jobId);
  const estadoBlob = await descargarSiExiste(rutas.estado);
  if (!estadoBlob) return null;

  let estado: Record<string, unknown>;
  try {
    estado = JSON.parse(await estadoBlob.text());
  } catch {
    estado = { ok: false, error: "n8n dejó un estado ilegible." };
  }
  if (estado.ok !== true) {
    void cleanupStorage([rutas.estado, rutas.excel]);
    throw new ConciliacionError(
      typeof estado.error === "string" && estado.error ? estado.error : "La conciliación falló en n8n.",
      "upstream_status",
      502,
    );
  }

  const blob = await descargarSiExiste(rutas.excel);
  if (!blob || blob.size === 0) {
    void cleanupStorage([rutas.estado, rutas.excel]);
    throw new ConciliacionError("El servicio devolvió un archivo vacío.", "upstream_empty", 502);
  }
  void cleanupStorage([rutas.estado, rutas.excel]);
  return {
    blob,
    filename: typeof estado.fileName === "string" && estado.fileName ? estado.fileName : FALLBACK_FILENAME,
    contentType: XLSX_CONTENT_TYPE,
    registrosNuevos: parseCount(estado.nuevos),
    registrosExistentes: parseCount(estado.existentes),
    registrosFueraPeriodo: parseCount(estado.fueraPeriodo),
  };
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

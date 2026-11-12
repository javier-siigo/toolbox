import "server-only";

import { unstable_cache } from "next/cache";

import { serverEnv } from "@/lib/env";
import { NetSuiteError, getAccessToken, netsuiteConfig, suiteQLPageAt } from "@/lib/netsuite/client";
import { createAdminClient } from "@/lib/supabase/admin";

import { BUCKET, ConciliacionError, rutasResultado, safeUserId } from "./conciliar";
import {
  ASIENTOS_EXTENSIONES,
  BALANCE_EXTENSIONES,
  MAX_ASIENTOS_BYTES,
  MAX_ASIENTOS_LABEL,
  MAX_BALANCE_BYTES,
  MAX_BALANCE_LABEL,
  type FuenteAsientos,
  type ResumenAsientos,
  type Subsidiaria,
} from "./asientos-shared";

/**
 * Conciliación de asientos de diario contra el balance (no depende de un país).
 *
 * El portal no cruza nada: sube el balance (y, si la fuente es "archivo", los asientos)
 * a Storage y le pasa a n8n URLs firmadas para descargarlos. n8n lee los archivos,
 * o consulta NetSuite por SuiteQL, concilia por cuenta y sube el Excel y su estado.
 * Ver docs/procesos/02-conciliaciones.md → "Asientos de diario".
 */

const WEBHOOK_URL = "https://juansiigo.app.n8n.cloud/webhook/conciliacion-asientos";
const REQUEST_TIMEOUT_MS = 60_000;
/** n8n descarga los archivos en segundo plano: la URL debe durar lo que tarda el flujo. */
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;
const FALLBACK_FILENAME = "conciliacion_asientos.xlsx";
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type KindAsientos = "balance" | "asientos";

export function extensionDe(nombre: string): string {
  return nombre.split(".").pop()?.toLowerCase() ?? "";
}

/** Valida nombre y tamaño del archivo según su rol. Lanza ConciliacionError. */
export function validarArchivoAsientos(kind: KindAsientos, nombre: string, size: number): void {
  if (size <= 0) throw new ConciliacionError("El archivo está vacío.", "missing_file", 400);
  const ext = extensionDe(nombre);
  if (kind === "balance") {
    if (!(BALANCE_EXTENSIONES as readonly string[]).includes(ext))
      throw new ConciliacionError("El balance debe ser .xlsx o .csv.", "invalid_type", 415);
    if (size > MAX_BALANCE_BYTES)
      throw new ConciliacionError(`El balance supera el límite de ${MAX_BALANCE_LABEL}.`, "file_too_large", 413);
  } else {
    if (!(ASIENTOS_EXTENSIONES as readonly string[]).includes(ext))
      throw new ConciliacionError("Los asientos deben ser .xlsx o .csv.", "invalid_type", 415);
    if (size > MAX_ASIENTOS_BYTES)
      throw new ConciliacionError(
        `El archivo de asientos supera ${MAX_ASIENTOS_LABEL}. Para un mes completo usa la consulta automática a NetSuite.`,
        "file_too_large",
        413,
      );
  }
}

/** `{usuario}/asientos-{kind}/{uuid}.{ext}`: así la ruta dice de quién es y qué rol tiene. */
export function rutaEntrada(userId: string, kind: KindAsientos, nombre: string): string {
  const ext = extensionDe(nombre).replace(/[^a-z0-9]/g, "") || "bin";
  return `${safeUserId(userId)}/asientos-${kind}/${crypto.randomUUID()}.${ext}`;
}

export function esRutaDe(userId: string, kind: KindAsientos, path: string): boolean {
  const prefix = `${safeUserId(userId)}/asientos-${kind}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("/");
}

/** Lista de entradas de un trabajo, para borrarlas cuando se lee el resultado. */
function rutaEntradasDelTrabajo(userId: string, jobId: string): string {
  return `${safeUserId(userId)}/resultado/${jobId}.entradas`;
}

export interface IniciarAsientosArgs {
  userId: string;
  jobId: string;
  fuente: FuenteAsientos;
  periodo: string;
  subsidiaria: Subsidiaria | null;
  balance: { storagePath: string; originalName: string };
  asientos?: { storagePath: string; originalName: string };
}

async function existeConTamano(path: string): Promise<number> {
  const carpeta = path.slice(0, path.lastIndexOf("/"));
  const nombre = path.slice(path.lastIndexOf("/") + 1);
  const { data, error } = await createAdminClient().storage.from(BUCKET).list(carpeta, { search: nombre, limit: 1 });
  const obj = data?.find((o) => o.name === nombre);
  if (error || !obj) {
    throw new ConciliacionError("El archivo subido ya no está disponible. Súbelo de nuevo.", "storage_not_found", 404);
  }
  return Number((obj.metadata as { size?: number } | null)?.size ?? 0);
}

async function firmarDescarga(path: string): Promise<string> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS);
  if (error || !data) throw new ConciliacionError("No se pudo preparar el archivo para n8n.", "upstream_config", 500);
  return data.signedUrl;
}

async function firmarSubida(path: string): Promise<string> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new ConciliacionError("No se pudo preparar dónde guardar el resultado.", "upstream_config", 500);
  return data.signedUrl;
}

/** Llama al webhook de n8n y vuelve en cuanto confirma la recepción (202). */
export async function iniciarConciliacionAsientos(args: IniciarAsientosArgs): Promise<void> {
  validarArchivoAsientos("balance", args.balance.originalName, await existeConTamano(args.balance.storagePath));
  if (args.asientos) {
    validarArchivoAsientos("asientos", args.asientos.originalName, await existeConTamano(args.asientos.storagePath));
  }

  const admin = createAdminClient();
  const entradas = [args.balance.storagePath, ...(args.asientos ? [args.asientos.storagePath] : [])];
  await admin.storage
    .from(BUCKET)
    .upload(rutaEntradasDelTrabajo(args.userId, args.jobId), JSON.stringify(entradas), {
      contentType: "application/octet-stream",
      upsert: true,
    });

  const rutas = rutasResultado(args.userId, args.jobId);
  const body = {
    fuente: args.fuente,
    periodo: args.periodo,
    subsidiariaId: args.subsidiaria?.id ?? "",
    subsidiariaNombre: args.subsidiaria?.nombre ?? "",
    balanceUrl: await firmarDescarga(args.balance.storagePath),
    balanceNombre: args.balance.originalName,
    ...(args.asientos
      ? { asientosUrl: await firmarDescarga(args.asientos.storagePath), asientosNombre: args.asientos.originalName }
      : {}),
    resultUploadUrl: await firmarSubida(rutas.excel),
    statusUploadUrl: await firmarSubida(rutas.estado),
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = serverEnv().N8N_WEBHOOK_SECRET;
  if (secret) headers["x-webhook-secret"] = secret;

  let response: Response;
  try {
    response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timeout = (err as Error).name === "TimeoutError" || (err as Error).name === "AbortError";
    throw new ConciliacionError(
      timeout ? "n8n no confirmó la recepción de la conciliación." : `No se pudo contactar a n8n: ${(err as Error).message}`,
      timeout ? "upstream_timeout" : "upstream_network",
      timeout ? 504 : 502,
    );
  }
  await response.body?.cancel().catch(() => {});
  if (response.status !== 202) {
    throw new ConciliacionError(`n8n respondió ${response.status}`, "upstream_status", response.ok ? 502 : response.status);
  }
}

export interface ResultadoAsientos {
  blob: Blob;
  filename: string;
  contentType: string;
  resumen: ResumenAsientos;
}

async function descargarSiExiste(path: string): Promise<Blob | null> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(path);
  if (data) return data;
  const msg = `${error?.message ?? ""} ${(error as { status?: number } | null)?.status ?? ""}`.toLowerCase();
  if (msg.includes("not found") || msg.includes("400") || msg.includes("404")) return null;
  throw new ConciliacionError("No se pudo leer el resultado.", "storage_unauthorized", 502);
}

async function limpiarTrabajo(userId: string, jobId: string): Promise<void> {
  const admin = createAdminClient().storage.from(BUCKET);
  const rutas = rutasResultado(userId, jobId);
  const lista = rutaEntradasDelTrabajo(userId, jobId);
  let entradas: string[] = [];
  try {
    const blob = await descargarSiExiste(lista);
    const parsed: unknown = blob ? JSON.parse(await blob.text()) : [];
    entradas = Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    // best-effort: la limpieza diaria del bucket borra lo que quede
  }
  await admin.remove([rutas.excel, rutas.estado, lista, ...entradas]).catch(() => {});
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
};

/** null mientras n8n trabaja. Lanza ConciliacionError si n8n informó un error. */
export async function leerResultadoAsientos(userId: string, jobId: string): Promise<ResultadoAsientos | null> {
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
    void limpiarTrabajo(userId, jobId);
    throw new ConciliacionError(
      typeof estado.error === "string" && estado.error ? estado.error : "La conciliación falló en n8n.",
      "upstream_status",
      502,
    );
  }
  const blob = await descargarSiExiste(rutas.excel);
  void limpiarTrabajo(userId, jobId);
  if (!blob || blob.size === 0) {
    throw new ConciliacionError("El servicio devolvió un archivo vacío.", "upstream_empty", 502);
  }
  return {
    blob,
    filename: typeof estado.fileName === "string" && estado.fileName ? estado.fileName : FALLBACK_FILENAME,
    contentType: XLSX_CONTENT_TYPE,
    resumen: {
      cuentas: num(estado.cuentas),
      cruzan: num(estado.cruzan),
      redondeo: num(estado.redondeo),
      noCruzan: num(estado.noCruzan),
      sinMovimiento: num(estado.sinMovimiento),
      lineas: num(estado.lineas),
      difDebito: num(estado.difDebito),
      difCredito: num(estado.difCredito),
    },
  };
}

/** Subsidiarias activas de NetSuite (sin las de eliminación), cacheadas 1 h. */
export const getSubsidiarias = unstable_cache(
  async (): Promise<Subsidiaria[]> => {
    const config = netsuiteConfig();
    const token = await getAccessToken(config);
    const { items } = await suiteQLPageAt(
      config,
      token,
      "SELECT id, name, country FROM subsidiary WHERE isinactive = 'F' AND iselimination = 'F' ORDER BY name",
      0,
    );
    return items
      .map((r) => ({ id: String(r.id ?? ""), nombre: String(r.name ?? ""), pais: String(r.country ?? "") }))
      .filter((s) => /^\d+$/.test(s.id) && s.nombre);
  },
  ["netsuite-subsidiarias"],
  { revalidate: 3600 },
);

/** Subsidiarias o lista vacía si NetSuite no responde: la página sigue funcionando con archivo. */
export async function getSubsidiariasSeguro(): Promise<{ subsidiarias: Subsidiaria[]; error: string | null }> {
  try {
    return { subsidiarias: await getSubsidiarias(), error: null };
  } catch (err) {
    console.error("[asientos] subsidiarias", err);
    return {
      subsidiarias: [],
      error: err instanceof NetSuiteError ? err.message : "No se pudo consultar NetSuite.",
    };
  }
}

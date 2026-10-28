import "server-only";

import { serverEnv } from "@/lib/env";

import { ConciliacionError } from "./conciliar";
import { parseArchivosConError, type ArchivoTxtConError } from "./particularidades";

const WEBHOOKS_TXT: Record<string, string> = {
  "MX:bananorte-mexico": "https://juansiigo.app.n8n.cloud/webhook/banorte-txt-a-excel",
};

const REQUEST_TIMEOUT_MS = 120_000;
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function getWebhookTxt(pais: string, banco: string): string | null {
  return WEBHOOKS_TXT[`${pais}:${banco}`] ?? null;
}

// Métricas numéricas que n8n envía en headers junto al Excel consolidado.
const RESUMEN_NUMERICO = [
  "x-archivos",
  "x-registros",
  "x-total-neto",
  "x-alertas",
  "x-errores",
  "x-duplicados-omitidos",
] as const;
// `[{archivo, error}]` serializado con encodeURIComponent.
const ARCHIVOS_ERROR_HEADER = "x-archivos-error";

export class ConversionTxtError extends ConciliacionError {
  archivosConError: ArchivoTxtConError[];

  constructor(
    message: string,
    code: ConciliacionError["code"],
    status: number,
    archivosConError: ArchivoTxtConError[] = [],
  ) {
    super(message, code, status);
    this.name = "ConversionTxtError";
    this.archivosConError = archivosConError;
  }
}

export interface ConversionTxtResult {
  blob: Blob;
  contentType: string;
  resumen: Headers;
}

async function readErrorBody(response: Response): Promise<{
  error: string | null;
  archivosConError: ArchivoTxtConError[];
}> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown; message?: unknown; archivosConError?: unknown }
    | null;
  const error =
    typeof payload?.error === "string"
      ? payload.error
      : typeof payload?.message === "string"
        ? payload.message
        : null;
  return { error, archivosConError: parseArchivosConError(payload?.archivosConError) };
}

export async function convertirTxt(args: {
  webhookUrl: string;
  pais: string;
  banco: string;
  files: File[];
}): Promise<ConversionTxtResult> {
  const env = serverEnv();

  const formData = new FormData();
  formData.append("pais", args.pais);
  formData.append("banco", args.banco);
  args.files.forEach((file, i) => {
    formData.append(`file_${i}`, file, file.name);
  });

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
      const { error, archivosConError } = await readErrorBody(response);
      throw new ConversionTxtError(
        error ?? `n8n respondió ${response.status}`,
        "upstream_status",
        response.status,
        archivosConError,
      );
    }

    const blob = await response.blob();
    if (blob.size === 0) {
      throw new ConversionTxtError(
        "n8n devolvió una respuesta vacía",
        "upstream_empty",
        502,
      );
    }

    const resumen = new Headers();
    for (const name of RESUMEN_NUMERICO) {
      const value = response.headers.get(name);
      if (value !== null && Number.isFinite(Number(value))) resumen.set(name, value);
    }
    const archivosError = response.headers.get(ARCHIVOS_ERROR_HEADER);
    if (archivosError) resumen.set(ARCHIVOS_ERROR_HEADER, archivosError);

    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim() || "";
    return {
      blob,
      // n8n a veces responde octet-stream; el resultado siempre es un .xlsx.
      contentType:
        contentType && contentType !== "application/octet-stream"
          ? contentType
          : XLSX_CONTENT_TYPE,
      resumen,
    };
  } catch (err) {
    if (err instanceof ConciliacionError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new ConversionTxtError(
        "Tiempo de espera agotado al convertir los TXT",
        "upstream_timeout",
        504,
      );
    }
    throw new ConversionTxtError(
      `No se pudo contactar a n8n: ${(err as Error).message}`,
      "upstream_network",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

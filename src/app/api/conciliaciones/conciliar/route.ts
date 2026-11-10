import { NextResponse } from "next/server";

import {
  ConciliacionError,
  cleanupStorage,
  iniciarConciliacion,
  leerResultado,
  safeUserId,
} from "@/lib/conciliaciones/conciliar";
import { getBancoPorSlug } from "@/lib/conciliaciones/bancos";
import { hoyEnPais, periodoVigente } from "@/lib/conciliaciones/periodo";
import { autorizar, respuestaDenegada } from "@/lib/auth/acceso";
import { CONCILIACION_POR_PAIS } from "@/lib/auth/permisos-shared";
import { PREVIO_INVALID_TYPE_MESSAGE, contentDispositionAdjunto, isXlsxFilename } from "@/lib/uploads";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const runtime = "nodejs";
export const maxDuration = 120;

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Inicia la conciliación en n8n y devuelve `202 { jobId }`; el resultado se consulta con GET. */
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

  const { pais, banco, bancoNombre, storagePathPrincipal, originalNamePrincipal, storagePathPrevio, originalNamePrevio } =
    body;

  if (typeof pais !== "string" || pais.length === 0) {
    return jsonError("Falta el país", "bad_request", 400);
  }
  const proceso = CONCILIACION_POR_PAIS[pais];
  if (!proceso) return jsonError("País no válido", "bad_request", 400);
  const acceso = await autorizar(proceso, "usar");
  if (!acceso.ok) return respuestaDenegada(acceso);
  const userId = acceso.userId;
  if (typeof banco !== "string" || banco.length === 0) {
    return jsonError("Falta el banco", "bad_request", 400);
  }
  if (typeof bancoNombre !== "string" || bancoNombre.length === 0) {
    return jsonError("Falta el nombre del banco", "bad_request", 400);
  }
  if (typeof storagePathPrincipal !== "string" || storagePathPrincipal.length === 0) {
    return jsonError("Falta el archivo principal", "missing_file", 400);
  }
  if (typeof originalNamePrincipal !== "string" || originalNamePrincipal.length === 0) {
    return jsonError("Falta el nombre del archivo principal", "bad_request", 400);
  }

  const principalPath = storagePathPrincipal as string;
  const previoPath =
    typeof storagePathPrevio === "string" && storagePathPrevio.length > 0
      ? storagePathPrevio
      : null;

  if (!isValidStoragePath(principalPath, userId, "principal")) {
    return jsonError("No tienes acceso a este archivo.", "storage_unauthorized", 403);
  }

  if (previoPath && !isValidStoragePath(previoPath, userId, "previo")) {
    return jsonError("No tienes acceso al archivo previo.", "storage_unauthorized", 403);
  }

  if (
    previoPath &&
    (typeof originalNamePrevio !== "string" || !isXlsxFilename(originalNamePrevio))
  ) {
    return jsonError(PREVIO_INVALID_TYPE_MESSAGE, "invalid_type", 415);
  }

  const bancoRow = await getBancoPorSlug(pais, banco);
  if (!bancoRow) {
    return jsonError(
      "El banco seleccionado no está disponible o no tiene una regla configurada.",
      "upstream_config",
      400,
    );
  }

  const pathsToCleanup = [principalPath];
  if (previoPath) {
    pathsToCleanup.push(previoPath);
  }

  try {
    const jobId = crypto.randomUUID();
    await iniciarConciliacion({
      userId,
      jobId,
      webhookUrl: bancoRow.webhookUrl,
      pais,
      banco,
      bancoNombre: bancoNombre as string,
      // El periodo se resuelve aquí (no lo manda el navegador) con la fecha del país.
      periodo: periodoVigente(
        { periodo: bancoRow.periodo, cierre: bancoRow.periodoCierre },
        hoyEnPais(pais),
      ),
      principal: {
        storagePath: principalPath,
        originalName: originalNamePrincipal as string,
      },
      previo:
        previoPath
          ? {
              storagePath: previoPath,
              originalName: originalNamePrevio as string,
            }
          : undefined,
    });

    // n8n ya tiene los archivos: los de entrada se pueden borrar.
    void cleanupStorage(pathsToCleanup);
    return NextResponse.json({ jobId }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ConciliacionError) {
      void cleanupStorage(pathsToCleanup);
      const message =
        err.code === "upstream_status" && err.status >= 500
          ? "El servicio de conciliación no está disponible. Intenta de nuevo."
          : err.code === "upstream_timeout"
            ? "El servicio de conciliación no respondió. Intenta de nuevo."
            : err.message;
      return NextResponse.json(
        { error: message, code: err.code },
        { status: err.status },
      );
    }
    void cleanupStorage(pathsToCleanup);
    return NextResponse.json(
      { error: "Error inesperado al conciliar", code: "internal" },
      { status: 500 },
    );
  }
}

/**
 * Estado de un trabajo: `202 { status: "pending" }` mientras n8n trabaja; al terminar, el Excel
 * (con los headers X-Registros-*) o `{ error, code }` si n8n informó un error.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const pais = params.get("pais") ?? "";
  const jobId = params.get("job") ?? "";
  const proceso = CONCILIACION_POR_PAIS[pais];
  if (!proceso) return jsonError("País no válido", "bad_request", 400);
  if (!JOB_ID_RE.test(jobId)) return jsonError("Trabajo no válido", "bad_request", 400);
  const acceso = await autorizar(proceso, "usar");
  if (!acceso.ok) return respuestaDenegada(acceso);

  try {
    // La ruta sale del usuario de la sesión: nadie lee el resultado de otro.
    const result = await leerResultado(acceso.userId, jobId);
    if (!result) {
      return NextResponse.json(
        { status: "pending" },
        { status: 202, headers: { "Cache-Control": "no-store" } },
      );
    }
    const headers = new Headers({
      "Content-Type": result.contentType,
      "Content-Disposition": contentDispositionAdjunto(result.filename),
      "Cache-Control": "no-store",
    });
    if (result.registrosNuevos !== null) {
      headers.set("X-Registros-Nuevos", String(result.registrosNuevos));
    }
    if (result.registrosExistentes !== null) {
      headers.set("X-Registros-Existentes", String(result.registrosExistentes));
    }
    if (result.registrosFueraPeriodo !== null) {
      headers.set("X-Registros-Fuera-Periodo", String(result.registrosFueraPeriodo));
    }
    return new Response(await result.blob.arrayBuffer(), { status: 200, headers });
  } catch (err) {
    if (err instanceof ConciliacionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Error inesperado al leer la conciliación", code: "internal" },
      { status: 500 },
    );
  }
}

function isValidStoragePath(
  path: string,
  userId: string,
  kind: "principal" | "previo",
): boolean {
  const safe = safeUserId(userId);
  const prefix = `${safe}/${kind}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("/");
}

import { NextResponse } from "next/server";

import { autorizar, respuestaDenegada } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import {
  esRutaDe,
  getSubsidiariasSeguro,
  iniciarConciliacionAsientos,
  leerResultadoAsientos,
} from "@/lib/conciliaciones/asientos";
import { PERIODO_RE, type FuenteAsientos } from "@/lib/conciliaciones/asientos-shared";
import { ConciliacionError } from "@/lib/conciliaciones/conciliar";
import { contentDispositionAdjunto } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 120;

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function archivo(value: unknown): { storagePath: string; originalName: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const { storagePath, originalName } = value as Record<string, unknown>;
  return typeof storagePath === "string" && storagePath && typeof originalName === "string" && originalName
    ? { storagePath, originalName }
    : null;
}

/** Inicia la conciliación en n8n: `202 { jobId }`. El resultado se consulta con GET. */
export async function POST(request: Request) {
  const acceso = await autorizar(PROCESOS.CONCILIACION_ASIENTOS, "usar");
  if (!acceso.ok) return respuestaDenegada(acceso);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonError("Cuerpo inválido: se esperaba JSON.", "bad_request", 400);

  const fuente = body.fuente;
  if (fuente !== "netsuite" && fuente !== "archivo") return jsonError("Fuente de asientos no válida.", "bad_request", 400);
  const periodo = body.periodo;
  if (typeof periodo !== "string" || !PERIODO_RE.test(periodo)) {
    return jsonError("Periodo no válido. Usa YYYY-MM.", "bad_request", 400);
  }

  const balance = archivo(body.balance);
  if (!balance) return jsonError("Falta el balance.", "missing_file", 400);
  if (!esRutaDe(acceso.userId, "balance", balance.storagePath)) {
    return jsonError("No tienes acceso a este archivo.", "storage_unauthorized", 403);
  }
  const asientos = fuente === "archivo" ? archivo(body.asientos) : null;
  if (fuente === "archivo") {
    if (!asientos) return jsonError("Falta el archivo de asientos.", "missing_file", 400);
    if (!esRutaDe(acceso.userId, "asientos", asientos.storagePath)) {
      return jsonError("No tienes acceso a este archivo.", "storage_unauthorized", 403);
    }
  }

  // La subsidiaria se resuelve aquí contra NetSuite: el navegador solo manda el id.
  let subsidiaria = null;
  if (typeof body.subsidiariaId === "string" && body.subsidiariaId) {
    const { subsidiarias } = await getSubsidiariasSeguro();
    subsidiaria = subsidiarias.find((s) => s.id === body.subsidiariaId) ?? null;
    if (!subsidiaria) return jsonError("Subsidiaria no válida.", "bad_request", 400);
  }
  if (fuente === "netsuite" && !subsidiaria) {
    return jsonError("Elige la subsidiaria del balance para consultar NetSuite.", "bad_request", 400);
  }

  try {
    const jobId = crypto.randomUUID();
    await iniciarConciliacionAsientos({
      userId: acceso.userId,
      jobId,
      fuente: fuente as FuenteAsientos,
      periodo,
      subsidiaria,
      balance,
      ...(asientos ? { asientos } : {}),
    });
    return NextResponse.json({ jobId }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof ConciliacionError) {
      const message =
        err.code === "upstream_status" && err.status >= 500
          ? "El servicio de conciliación no está disponible. Intenta de nuevo."
          : err.message;
      return jsonError(message, err.code, err.status);
    }
    console.error("[asientos] iniciar", err);
    return jsonError("Error inesperado al iniciar la conciliación.", "internal", 500);
  }
}

/** `202 { status: "pending" }` mientras n8n trabaja; al terminar, el Excel con el resumen en headers. */
export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("job") ?? "";
  if (!JOB_ID_RE.test(jobId)) return jsonError("Trabajo no válido.", "bad_request", 400);
  const acceso = await autorizar(PROCESOS.CONCILIACION_ASIENTOS, "usar");
  if (!acceso.ok) return respuestaDenegada(acceso);

  try {
    // La ruta sale del usuario de la sesión: nadie lee el resultado de otro.
    const result = await leerResultadoAsientos(acceso.userId, jobId);
    if (!result) {
      return NextResponse.json({ status: "pending" }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    return new Response(await result.blob.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": contentDispositionAdjunto(result.filename),
        "Cache-Control": "no-store",
        "X-Resumen": encodeURIComponent(JSON.stringify(result.resumen)),
      },
    });
  } catch (err) {
    if (err instanceof ConciliacionError) return jsonError(err.message, err.code, err.status);
    console.error("[asientos] resultado", err);
    return jsonError("Error inesperado al leer la conciliación.", "internal", 500);
  }
}

import { NextResponse } from "next/server";

import { autorizar, respuestaDenegada } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { getSubsidiariasSeguro } from "@/lib/conciliaciones/asientos";
import { partidasAbiertas, partidasConAplicaciones, terceros } from "@/lib/conciliaciones/cartera-1305";
import { FECHA_RE, MAX_IDS_TERCEROS, aTupla } from "@/lib/conciliaciones/cartera-1305-shared";
import { NetSuiteError } from "@/lib/netsuite/client";
import { NETSUITE_STATUS, jsonError } from "@/lib/netsuite/peticion-bancos";

export const runtime = "nodejs";
/** Un tramo tarda ~1 min en NetSuite; el navegador pide varios en paralelo. */
export const maxDuration = 300;

const ID_RE = /^\d{1,12}$/;

const hoyBogota = () => new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);

/**
 * `POST { accion, ... }`:
 * - `abiertas` `{ subsidiariaId, corte, desde|null, hasta }` → `{ partidas }` abiertas hoy con fecha en el tramo.
 * - `aplicaciones` `{ subsidiariaId, corte, desde, hasta }` → `{ partidas }` aplicadas en el tramo (posterior al corte).
 * - `terceros` `{ ids }` → `{ terceros }` nombre y KS Documento.
 * Solo lee NetSuite: basta el nivel `ver`.
 */
export async function POST(request: Request) {
  const acceso = await autorizar(PROCESOS.CONCILIACION_1305, "ver");
  if (!acceso.ok) return respuestaDenegada(acceso);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError("Cuerpo inválido: se esperaba JSON.", "bad_request", 400);

  try {
    if (body.accion === "terceros") {
      const ids = body.ids;
      if (!Array.isArray(ids) || ids.length > MAX_IDS_TERCEROS || !ids.every((i) => typeof i === "string" && ID_RE.test(i))) {
        return jsonError("Ids de terceros no válidos.", "bad_request", 400);
      }
      return NextResponse.json({ terceros: await terceros(ids, request.signal) }, { headers: { "Cache-Control": "no-store" } });
    }

    if (body.accion !== "abiertas" && body.accion !== "aplicaciones") {
      return jsonError("Acción no válida.", "bad_request", 400);
    }
    const { subsidiariaId, corte, desde, hasta } = body;
    const hoy = hoyBogota();
    if (typeof corte !== "string" || !FECHA_RE.test(corte) || corte >= hoy) {
      return jsonError("La fecha de corte debe ser anterior a hoy (YYYY-MM-DD).", "bad_request", 400);
    }
    if (typeof hasta !== "string" || !FECHA_RE.test(hasta)) return jsonError("Tramo no válido.", "bad_request", 400);
    if (desde !== null && (typeof desde !== "string" || !FECHA_RE.test(desde) || desde > hasta)) {
      return jsonError("Tramo no válido.", "bad_request", 400);
    }
    const { subsidiarias } = await getSubsidiariasSeguro();
    if (typeof subsidiariaId !== "string" || !subsidiarias.some((s) => s.id === subsidiariaId)) {
      return jsonError("Subsidiaria no válida.", "bad_request", 400);
    }

    let partidas;
    if (body.accion === "abiertas") {
      if (hasta > corte) return jsonError("El tramo pasa la fecha de corte.", "bad_request", 400);
      partidas = await partidasAbiertas(subsidiariaId, desde, hasta, request.signal);
    } else {
      if (desde === null || desde <= corte) return jsonError("Las aplicaciones se piden después del corte.", "bad_request", 400);
      partidas = await partidasConAplicaciones(subsidiariaId, corte, desde, hasta, request.signal);
    }
    return NextResponse.json({ partidas: partidas.map(aTupla) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof NetSuiteError) return jsonError(err.message, err.code, NETSUITE_STATUS[err.code]);
    console.error("[cartera-1305]", err);
    return jsonError("Error inesperado al consultar NetSuite.", "internal", 500);
  }
}

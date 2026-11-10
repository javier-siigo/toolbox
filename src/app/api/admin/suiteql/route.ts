import { NextResponse } from "next/server";

import { autorizarAdmin, respuestaDenegada } from "@/lib/auth/acceso";
import { ejecutarConsola } from "@/lib/netsuite/consola";
import { jsonError, respuestaDeError } from "@/lib/netsuite/peticion-bancos";

export const runtime = "nodejs";
export const maxDuration = 300;

const LIMITES = new Set([10, 50, 100, 500, 1000]);
const MAX_QUERY = 50_000;

export async function POST(request: Request) {
  const acceso = await autorizarAdmin();
  if (!acceso.ok) return respuestaDenegada(acceso);

  let body: { q?: unknown; limite?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("Cuerpo inválido: se esperaba JSON", "bad_request", 400);
  }

  const q = typeof body.q === "string" ? body.q.trim().replace(/;\s*$/, "") : "";
  if (!q) return jsonError("Escribe una query SuiteQL.", "bad_request", 400);
  if (q.length > MAX_QUERY) return jsonError("La query es demasiado larga.", "bad_request", 400);

  const limite =
    body.limite === "todas"
      ? "todas"
      : typeof body.limite === "number" && LIMITES.has(body.limite)
        ? body.limite
        : null;
  if (limite === null) return jsonError("Límite inválido.", "bad_request", 400);

  try {
    const resultado = await ejecutarConsola(q, limite, request.signal);
    console.info(
      `[admin-suiteql] ${acceso.email}: ${resultado.filas.length}/${resultado.total ?? "?"} filas en ${resultado.duracionMs} ms`,
    );
    return NextResponse.json(resultado, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return (
      respuestaDeError(err, "admin-suiteql") ??
      jsonError("Error inesperado al ejecutar la query.", "internal", 500)
    );
  }
}

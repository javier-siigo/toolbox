import { NextResponse } from "next/server";

import {
  ConversionTxtError,
  convertirTxt,
  getWebhookTxt,
} from "@/lib/conciliaciones/convertir-txt";
import {
  MAX_TXT_FILES,
  MAX_TXT_TOTAL_BYTES,
  MAX_TXT_TOTAL_LABEL,
  isTxtFilename,
} from "@/lib/conciliaciones/particularidades";
import { createClient } from "@/lib/supabase/server";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    return jsonError("Tu sesión expiró. Vuelve a iniciar sesión.", "unauthorized", 401);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Cuerpo inválido: se esperaba multipart/form-data", "bad_request", 400);
  }

  const pais = form.get("pais");
  const banco = form.get("banco");
  const files = form
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (typeof pais !== "string" || pais.length === 0) {
    return jsonError("Falta el país", "bad_request", 400);
  }
  if (typeof banco !== "string" || banco.length === 0) {
    return jsonError("Falta el banco", "bad_request", 400);
  }
  if (files.length === 0) {
    return jsonError("Falta al menos un archivo TXT", "missing_file", 400);
  }
  if (files.length > MAX_TXT_FILES) {
    return jsonError(
      `Puedes subir hasta ${MAX_TXT_FILES} archivos TXT a la vez.`,
      "bad_request",
      400,
    );
  }
  const noTxt = files.find((f) => !isTxtFilename(f.name));
  if (noTxt) {
    return jsonError(`${noTxt.name} no es un archivo .txt.`, "invalid_type", 415);
  }
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TXT_TOTAL_BYTES) {
    return jsonError(
      `Los TXT superan el límite de ${MAX_TXT_TOTAL_LABEL} en total.`,
      "file_too_large",
      413,
    );
  }

  const webhookUrl = getWebhookTxt(pais, banco);
  if (!webhookUrl) {
    return jsonError(
      "Este banco no tiene conversión de TXT configurada.",
      "upstream_config",
      400,
    );
  }

  try {
    const result = await convertirTxt({ webhookUrl, pais, banco, files });
    const arrayBuffer = await result.blob.arrayBuffer();
    const headers = new Headers(result.resumen);
    headers.set("Content-Type", result.contentType);
    headers.set("Cache-Control", "no-store");
    return new Response(arrayBuffer, { status: 200, headers });
  } catch (err) {
    if (err instanceof ConversionTxtError) {
      const message =
        err.code === "upstream_timeout"
          ? "La conversión de los TXT tardó demasiado. Intenta de nuevo."
          : err.code === "upstream_empty"
            ? "El servicio devolvió un Excel vacío."
            : err.code === "upstream_status" &&
                err.status >= 500 &&
                err.archivosConError.length === 0
              ? `El servicio de conversión falló (${err.message}). Intenta de nuevo.`
              : err.message;
      return NextResponse.json(
        { error: message, code: err.code, archivosConError: err.archivosConError },
        { status: err.status },
      );
    }
    return jsonError("Error inesperado al convertir los TXT", "internal", 500);
  }
}

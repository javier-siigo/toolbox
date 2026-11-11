import { NextResponse } from "next/server";

import {
  ConversionTxtError,
  convertirTxt,
  getWebhookConversion,
} from "@/lib/conciliaciones/convertir-txt";
import {
  FORMATO_LABEL,
  MAX_TXT_FILES,
  MAX_TXT_TOTAL_BYTES,
  MAX_TXT_TOTAL_LABEL,
  esArchivoDeConversion,
  getConversion,
  mensajeFormatoInvalido,
} from "@/lib/conciliaciones/particularidades";
import { getBancoPorSlug } from "@/lib/conciliaciones/bancos";
import { hoyEnPais, periodoVigente } from "@/lib/conciliaciones/periodo";
import { autorizar, respuestaDenegada } from "@/lib/auth/acceso";
import { CONCILIACION_POR_PAIS } from "@/lib/auth/permisos-shared";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export const runtime = "nodejs";
export const maxDuration = 150;

export async function POST(request: Request) {
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
  const proceso = CONCILIACION_POR_PAIS[pais];
  if (!proceso) return jsonError("País no válido", "bad_request", 400);
  const acceso = await autorizar(proceso, "usar");
  if (!acceso.ok) return respuestaDenegada(acceso);
  if (typeof banco !== "string" || banco.length === 0) {
    return jsonError("Falta el banco", "bad_request", 400);
  }
  const config = getConversion(pais, banco);
  const webhookUrl = config && getWebhookConversion(pais, banco, config.formato);
  if (!config || !webhookUrl) {
    return jsonError(
      "Este banco no tiene unificación de archivos configurada.",
      "upstream_config",
      400,
    );
  }
  const etiqueta = FORMATO_LABEL[config.formato];

  if (files.length === 0) {
    return jsonError(`Falta al menos un archivo ${etiqueta}`, "missing_file", 400);
  }
  if (files.length > MAX_TXT_FILES) {
    return jsonError(
      `Puedes subir hasta ${MAX_TXT_FILES} archivos ${etiqueta} a la vez.`,
      "bad_request",
      400,
    );
  }
  const invalido = files.find((f) => !esArchivoDeConversion(f.name, config));
  if (invalido) {
    return jsonError(mensajeFormatoInvalido(invalido.name, config), "invalid_type", 415);
  }
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TXT_TOTAL_BYTES) {
    return jsonError(
      `Los archivos superan el límite de ${MAX_TXT_TOTAL_LABEL} en total.`,
      "file_too_large",
      413,
    );
  }

  const bancoRow = await getBancoPorSlug(pais, banco);
  if (!bancoRow) {
    return jsonError("El banco seleccionado no está disponible.", "upstream_config", 400);
  }
  const periodo = periodoVigente(
    { periodo: bancoRow.periodo, cierre: bancoRow.periodoCierre },
    hoyEnPais(pais),
  );

  try {
    const result = await convertirTxt({ webhookUrl, pais, banco, periodo, files });
    const arrayBuffer = await result.blob.arrayBuffer();
    const headers = new Headers(result.resumen);
    headers.set("Content-Type", result.contentType);
    headers.set("Cache-Control", "no-store");
    return new Response(arrayBuffer, { status: 200, headers });
  } catch (err) {
    if (err instanceof ConversionTxtError) {
      const message =
        err.code === "upstream_timeout"
          ? `La unificación de los archivos ${etiqueta} tardó demasiado. Intenta de nuevo.`
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
    return jsonError("Error inesperado al unificar los archivos", "internal", 500);
  }
}

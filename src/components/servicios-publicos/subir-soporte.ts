import {
  confirmarSoporte,
  prepararSubidaSoporte,
} from "@/lib/servicios-publicos/actions";
import { SOPORTE_MAX_BYTES, SOPORTE_TIPOS } from "@/lib/servicios-publicos/schema";

const TIPO_POR_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
};

/** Algunos navegadores no informan el tipo (p. ej. HEIC): se deduce de la extensión. */
function tipoDe(file: File): string {
  if (file.type) return file.type;
  return TIPO_POR_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

/**
 * Sube el soporte de pago de un recibo: pide una URL firmada, sube el archivo directo a
 * Storage y lo asocia al recibo. Cada paso devuelve un error entendible si falla.
 */
export async function subirSoporte(reciboId: string, file: File): Promise<{ ok: true } | { ok: false; error: string }> {
  const tipo = tipoDe(file);
  if (!(SOPORTE_TIPOS as readonly string[]).includes(tipo)) {
    return { ok: false, error: "Formato no permitido. Usa PDF o una imagen (PNG, JPG, WEBP, HEIC)." };
  }
  if (file.size > SOPORTE_MAX_BYTES) return { ok: false, error: "El archivo debe pesar menos de 10 MB." };

  const preparado = await prepararSubidaSoporte(reciboId, { nombre: file.name, tipo, tamano: file.size });
  if (!preparado.url || !preparado.path) {
    return { ok: false, error: preparado.error ?? "No se pudo preparar la subida." };
  }

  let res: Response;
  try {
    res = await fetch(preparado.url, { method: "PUT", headers: { "Content-Type": tipo }, body: file });
  } catch {
    return { ok: false, error: "Se perdió la conexión al subir el archivo. Intenta de nuevo." };
  }
  if (!res.ok) {
    console.error("[servicios-publicos] subida de soporte", res.status, await res.text().catch(() => ""));
    return { ok: false, error: "Storage rechazó el archivo. Revisa el formato y el tamaño e intenta de nuevo." };
  }

  const confirmado = await confirmarSoporte(reciboId, preparado.path, file.name);
  if (!confirmado.ok) return { ok: false, error: confirmado.error ?? "No se pudo asociar el soporte." };
  return { ok: true };
}

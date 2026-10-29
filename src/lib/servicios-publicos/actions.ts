"use server";

import { revalidatePath } from "next/cache";

import { autorizar } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_RECIBOS,
  SOPORTE_BUCKET,
  SOPORTE_MAX_BYTES,
  SOPORTE_TIPOS,
  esEstado,
  pasoSchema,
  reciboSchema,
  servicioSchema,
  type EventoHistorial,
  type Recibo,
  type ReciboField,
  type Servicio,
  type ServicioField,
} from "@/lib/servicios-publicos/schema";

const RUTA = "/ingresos-egresos/servicios-publicos";
const PROCESO = PROCESOS.SERVICIOS_PUBLICOS;
const URL_SOPORTE_TTL_SECONDS = 60;
const ERROR_GENERICO = "No se pudo guardar. Intenta de nuevo; si persiste, avisa al equipo del portal.";

type PostgrestError = { code?: string; message: string };

/** Traduce errores de la BD a mensajes para el usuario y deja el detalle técnico en el log. */
function mensajeDeError(contexto: string, error: PostgrestError): string {
  console.error(`[servicios-publicos] ${contexto}`, error);
  const m = error.message;
  if (error.code === "42501") return "No tienes permisos para esta acción.";
  if (m.includes("recibos_soporte_solo_pagado")) return "Quita primero el soporte de pago para revertir el pago.";
  if (m.includes("recibos_pago_requiere_registro")) return "Un recibo pagado debe estar registrado.";
  if (m.includes("recibos_registro_requiere_valor")) return "El valor es obligatorio para registrar el recibo.";
  if (m.includes("recibos_registro_requiere_factura")) return "Para registrar, indica cuándo llegó la factura.";
  if (m.includes("recibos_registro_despues_factura")) return "El registro no puede ser anterior a la llegada de la factura.";
  if (m.includes("recibos_pago_despues_registro")) return "El pago no puede ser anterior al registro.";
  if (error.code === "23503") return "El servicio tiene recibos asociados.";
  return ERROR_GENERICO;
}

function aFecha(value: string): string | null {
  return value === "" ? null : value;
}

function aTexto(value: string): string | null {
  return value === "" ? null : value;
}

// ─── Lectura ───────────────────────────────────────────────────────────────

export interface DatosServiciosPublicos {
  servicios: Servicio[];
  recibos: Recibo[];
}

export async function getServiciosPublicos(): Promise<DatosServiciosPublicos> {
  const acceso = await autorizar(PROCESO, "ver");
  if (!acceso.ok) return { servicios: [], recibos: [] };
  const sp = acceso.supabase.schema("servicios_publicos");

  const [servicios, recibos] = await Promise.all([
    sp
      .from("servicios")
      .select("id, proveedor, servicio, referencia, dia_corte, activo, notas")
      .order("proveedor")
      .order("servicio"),
    sp
      .from("recibos")
      .select(
        "id, servicio_id, mes, referencia, valor, fecha_corte, fecha_recibido, fecha_registro, fecha_pago, soporte_nombre, soporte_subido_at, observaciones, estado, updated_at, servicios(proveedor, servicio)",
      )
      .order("mes", { ascending: false })
      .limit(MAX_RECIBOS),
  ]);

  if (servicios.error) throw new Error(`No se pudieron cargar los servicios: ${servicios.error.message}`);
  if (recibos.error) throw new Error(`No se pudieron cargar los recibos: ${recibos.error.message}`);

  return {
    servicios: servicios.data,
    recibos: recibos.data.map(({ servicios: s, ...r }) => ({
      ...r,
      mes: r.mes.slice(0, 7),
      valor: r.valor === null ? null : Number(r.valor),
      estado: esEstado(r.estado) ? r.estado : "pendiente_factura",
      proveedor: s?.proveedor ?? "—",
      servicio: s?.servicio ?? "—",
    })),
  };
}

export async function getHistorialRecibo(id: string): Promise<{ eventos?: EventoHistorial[]; error?: string }> {
  const acceso = await autorizar(PROCESO, "ver");
  if (!acceso.ok) return { error: acceso.error };
  const { data, error } = await acceso.supabase
    .schema("servicios_publicos")
    .from("recibos_historial")
    .select("id, evento, detalle, usuario, at")
    .eq("recibo_id", id)
    .order("at", { ascending: false });
  if (error) return { error: mensajeDeError("historial", error) };
  return { eventos: data as EventoHistorial[] };
}

// ─── Recibos ───────────────────────────────────────────────────────────────

export type GuardarReciboState = {
  ok?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<ReciboField, string>>;
};

export async function guardarRecibo(
  _prev: GuardarReciboState | undefined,
  formData: FormData,
): Promise<GuardarReciboState> {
  const raw = Object.fromEntries(
    ["id", "servicio_id", "mes", "referencia", "valor", "fecha_corte", "fecha_recibido", "fecha_registro", "fecha_pago", "observaciones"].map(
      (k) => [k, String(formData.get(k) ?? "")],
    ),
  );
  const parsed = reciboSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: GuardarReciboState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") fieldErrors[key as ReciboField] ??= issue.message;
    }
    return { error: "Revisa los campos marcados", fieldErrors };
  }

  const acceso = await autorizar(PROCESO, "usar");
  if (!acceso.ok) return { error: acceso.error };
  const { supabase, userId } = acceso;

  const v = parsed.data;
  const fila = {
    servicio_id: v.servicio_id,
    mes: `${v.mes}-01`,
    referencia: aTexto(v.referencia),
    valor: v.valor === "" ? null : Number(v.valor),
    fecha_corte: aFecha(v.fecha_corte),
    fecha_recibido: aFecha(v.fecha_recibido),
    fecha_registro: aFecha(v.fecha_registro),
    fecha_pago: aFecha(v.fecha_pago),
    observaciones: aTexto(v.observaciones),
    updated_by: userId,
  };

  const recibos = supabase.schema("servicios_publicos").from("recibos");
  const { data, error } = v.id
    ? await recibos.update(fila).eq("id", v.id).select("id")
    : await recibos.insert({ ...fila, created_by: userId }).select("id");

  if (error) {
    if (error.code === "23505") {
      const msg = "Ya hay un recibo de este servicio para ese mes. Búscalo en la tabla y edítalo.";
      return { error: msg, fieldErrors: { mes: msg } };
    }
    return { error: mensajeDeError("guardar recibo", error) };
  }
  if (data.length === 0) return { error: "El recibo ya no existe. Recarga la página." };

  revalidatePath(RUTA);
  return { ok: true };
}

/**
 * Avanza un paso con una sola fecha: registrar (factura → Tesorería) o pagar.
 * Solo aplica si el recibo sigue en el estado anterior; si otro usuario lo cambió, avisa.
 */
export async function marcarPaso(
  id: string,
  paso: "registrar" | "pagar",
  fecha: string,
): Promise<{ ok?: boolean; error?: string }> {
  const parsed = pasoSchema.safeParse({ id, paso, fecha });
  if (!parsed.success) return { error: "Revisa la fecha." };

  const acceso = await autorizar(PROCESO, "usar");
  if (!acceso.ok) return { error: acceso.error };
  const { supabase, userId } = acceso;

  const cambio =
    paso === "registrar"
      ? { fecha_registro: fecha, updated_by: userId }
      : { fecha_pago: fecha, updated_by: userId };
  const estadoPrevio = paso === "registrar" ? "recibido" : "registrado";

  const { data, error } = await supabase
    .schema("servicios_publicos")
    .from("recibos")
    .update(cambio)
    .eq("id", id)
    .eq("estado", estadoPrevio)
    .select("id");

  if (error) return { error: mensajeDeError(`marcar ${paso}`, error) };
  if (data.length === 0) {
    return { error: "El recibo cambió mientras lo veías. Recarga la página y revisa su estado." };
  }

  revalidatePath(RUTA);
  return { ok: true };
}

export async function eliminarRecibo(id: string): Promise<{ ok?: boolean; error?: string }> {
  const acceso = await autorizar(PROCESO, "usar");
  if (!acceso.ok) return { error: acceso.error };

  const { data, error } = await acceso.supabase
    .schema("servicios_publicos")
    .from("recibos")
    .delete()
    .eq("id", id)
    .select("soporte_path");
  if (error) return { error: mensajeDeError("eliminar recibo", error) };
  if (data.length === 0) return { error: "El recibo ya no existe. Recarga la página." };

  const path = data[0]?.soporte_path;
  if (path) {
    const { error: rmError } = await createAdminClient().storage.from(SOPORTE_BUCKET).remove([path]);
    if (rmError) console.error("[servicios-publicos] soporte huérfano tras eliminar recibo", { path, rmError });
  }

  revalidatePath(RUTA);
  return { ok: true };
}

/** Crea los recibos "pendiente de factura" del mes para los servicios activos que aún no lo tienen. */
export async function prepararMes(mes: string): Promise<{ creados?: number; error?: string }> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return { error: "Mes inválido." };
  const acceso = await autorizar(PROCESO, "usar");
  if (!acceso.ok) return { error: acceso.error };

  const { data, error } = await acceso.supabase
    .schema("servicios_publicos")
    .rpc("preparar_mes", { p_mes: `${mes}-01` });
  if (error) return { error: mensajeDeError("preparar mes", error) };

  revalidatePath(RUTA);
  return { creados: data };
}

// ─── Soportes ──────────────────────────────────────────────────────────────

/**
 * Paso 1 de 2: URL firmada para que el navegador suba el archivo directo a Storage (no pasa
 * por el servidor, así no aplica el límite de tamaño de las server actions).
 */
export async function prepararSubidaSoporte(
  id: string,
  archivo: { nombre: string; tipo: string; tamano: number },
): Promise<{ url?: string; path?: string; error?: string }> {
  if (!(SOPORTE_TIPOS as readonly string[]).includes(archivo.tipo)) {
    return { error: "Formato no permitido. Usa PDF o una imagen (PNG, JPG, WEBP, HEIC)." };
  }
  if (archivo.tamano <= 0 || archivo.tamano > SOPORTE_MAX_BYTES) {
    return { error: "El archivo debe pesar menos de 10 MB." };
  }

  const acceso = await autorizar(PROCESO, "usar");
  if (!acceso.ok) return { error: acceso.error };

  const { data: recibo, error } = await acceso.supabase
    .schema("servicios_publicos")
    .from("recibos")
    .select("estado")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: mensajeDeError("preparar soporte", error) };
  if (!recibo) return { error: "El recibo ya no existe. Recarga la página." };
  if (recibo.estado !== "pagado") return { error: "Marca el recibo como pagado antes de adjuntar el soporte." };

  const ext = archivo.nombre.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${id}/${crypto.randomUUID()}.${ext}`;
  const { data, error: signError } = await createAdminClient()
    .storage.from(SOPORTE_BUCKET)
    .createSignedUploadUrl(path);
  if (signError || !data) {
    console.error("[servicios-publicos] url de subida", { path, signError });
    return { error: "No se pudo preparar la subida. Intenta de nuevo." };
  }
  return { url: data.signedUrl, path: data.path };
}

/**
 * Paso 2 de 2: asocia el archivo subido al recibo. Si falla, borra el archivo para no dejar
 * huérfanos; si reemplaza uno anterior, borra el anterior solo después de guardar.
 */
export async function confirmarSoporte(
  id: string,
  path: string,
  nombre: string,
): Promise<{ ok?: boolean; error?: string }> {
  const acceso = await autorizar(PROCESO, "usar");
  if (!acceso.ok) return { error: acceso.error };
  if (!path.startsWith(`${id}/`) || path.includes("..")) return { error: "Archivo inválido." };

  const admin = createAdminClient();
  const bucket = admin.storage.from(SOPORTE_BUCKET);
  const { data: existe } = await bucket.exists(path);
  if (!existe) return { error: "El archivo no terminó de subir. Intenta de nuevo." };

  const sp = acceso.supabase.schema("servicios_publicos");
  const { data: actual, error: leerError } = await sp
    .from("recibos")
    .select("soporte_path")
    .eq("id", id)
    .maybeSingle();

  const { data, error } = leerError
    ? { data: null, error: leerError }
    : await sp
        .from("recibos")
        .update({
          soporte_path: path,
          soporte_nombre: nombre.slice(0, 200),
          soporte_subido_at: new Date().toISOString(),
          updated_by: acceso.userId,
        })
        .eq("id", id)
        .eq("estado", "pagado")
        .select("id");

  if (error || !data || data.length === 0) {
    await bucket.remove([path]);
    if (error) return { error: mensajeDeError("confirmar soporte", error) };
    return { error: "El recibo ya no está pagado o no existe. Recarga la página." };
  }

  if (actual?.soporte_path && actual.soporte_path !== path) {
    const { error: rmError } = await bucket.remove([actual.soporte_path]);
    if (rmError) console.error("[servicios-publicos] soporte anterior huérfano", { path: actual.soporte_path, rmError });
  }

  revalidatePath(RUTA);
  return { ok: true };
}

export async function quitarSoporte(id: string): Promise<{ ok?: boolean; error?: string }> {
  const acceso = await autorizar(PROCESO, "usar");
  if (!acceso.ok) return { error: acceso.error };
  const sp = acceso.supabase.schema("servicios_publicos");

  const { data: actual, error: leerError } = await sp
    .from("recibos")
    .select("soporte_path")
    .eq("id", id)
    .maybeSingle();
  if (leerError) return { error: mensajeDeError("quitar soporte", leerError) };
  if (!actual?.soporte_path) return { ok: true };

  const { data, error } = await sp
    .from("recibos")
    .update({ soporte_path: null, soporte_nombre: null, soporte_subido_at: null, updated_by: acceso.userId })
    .eq("id", id)
    .select("id");
  if (error) return { error: mensajeDeError("quitar soporte", error) };
  // Sin filas, el archivo sigue referenciado: no se borra.
  if (data.length === 0) return { error: "No se pudo quitar el soporte. Recarga la página." };

  const { error: rmError } = await createAdminClient().storage.from(SOPORTE_BUCKET).remove([actual.soporte_path]);
  if (rmError) console.error("[servicios-publicos] soporte huérfano", { path: actual.soporte_path, rmError });

  revalidatePath(RUTA);
  return { ok: true };
}

/** URL de descarga de corta duración. Lee la ruta con la sesión del usuario: RLS decide si puede. */
export async function urlSoporte(id: string): Promise<{ url?: string; error?: string }> {
  const acceso = await autorizar(PROCESO, "ver");
  if (!acceso.ok) return { error: acceso.error };

  const { data, error } = await acceso.supabase
    .schema("servicios_publicos")
    .from("recibos")
    .select("soporte_path")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: mensajeDeError("ver soporte", error) };
  if (!data?.soporte_path) return { error: "Este recibo no tiene soporte." };

  const { data: signed, error: signError } = await createAdminClient()
    .storage.from(SOPORTE_BUCKET)
    .createSignedUrl(data.soporte_path, URL_SOPORTE_TTL_SECONDS);
  if (signError || !signed) {
    console.error("[servicios-publicos] url de descarga", { path: data.soporte_path, signError });
    return { error: "No se pudo abrir el soporte. Intenta de nuevo." };
  }
  return { url: signed.signedUrl };
}

// ─── Servicios (catálogo) ──────────────────────────────────────────────────

export type GuardarServicioState = {
  ok?: boolean;
  /** Id del servicio guardado (para seleccionarlo al crearlo desde el formulario de recibo). */
  id?: string;
  error?: string;
  fieldErrors?: Partial<Record<ServicioField, string>>;
};

export async function guardarServicio(
  _prev: GuardarServicioState | undefined,
  formData: FormData,
): Promise<GuardarServicioState> {
  const raw = Object.fromEntries(
    ["id", "proveedor", "servicio", "referencia", "dia_corte", "notas"].map((k) => [k, String(formData.get(k) ?? "")]),
  );
  const parsed = servicioSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: GuardarServicioState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") fieldErrors[key as ServicioField] ??= issue.message;
    }
    return { error: "Revisa los campos marcados", fieldErrors };
  }

  const acceso = await autorizar(PROCESO, "usar");
  if (!acceso.ok) return { error: acceso.error };
  const { supabase, userId } = acceso;

  const v = parsed.data;
  const fila = {
    proveedor: v.proveedor,
    servicio: v.servicio,
    referencia: aTexto(v.referencia),
    dia_corte: v.dia_corte === "" ? null : Number(v.dia_corte),
    notas: aTexto(v.notas),
    updated_by: userId,
  };
  const servicios = supabase.schema("servicios_publicos").from("servicios");
  const { data, error } = v.id
    ? await servicios.update(fila).eq("id", v.id).select("id")
    : await servicios.insert({ ...fila, created_by: userId }).select("id");

  if (error) {
    if (error.code === "23505") {
      const msg = "Ya existe un servicio con este proveedor, tipo y referencia.";
      return { error: msg, fieldErrors: { referencia: msg } };
    }
    return { error: mensajeDeError("guardar servicio", error) };
  }
  const guardado = data[0];
  if (!guardado) return { error: "El servicio ya no existe. Recarga la página." };

  revalidatePath(RUTA);
  return { ok: true, id: guardado.id };
}

export async function cambiarActivoServicio(id: string, activo: boolean): Promise<{ ok?: boolean; error?: string }> {
  const acceso = await autorizar(PROCESO, "usar");
  if (!acceso.ok) return { error: acceso.error };
  const { data, error } = await acceso.supabase
    .schema("servicios_publicos")
    .from("servicios")
    .update({ activo, updated_by: acceso.userId })
    .eq("id", id)
    .select("id");
  if (error) return { error: mensajeDeError("activar servicio", error) };
  if (data.length === 0) return { error: "El servicio ya no existe. Recarga la página." };
  revalidatePath(RUTA);
  return { ok: true };
}

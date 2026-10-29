"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserRoles, hasIngresosOrAdmin, isAdmin } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/supabase";

import {
  CAMPO_RE,
  CAMPOS_TERCERO,
  TABLAS,
  TIPOS,
  claveCampo,
  type CampoCatalogo,
  type CampoDescubierto,
  type Plantilla,
} from "./campos";
import { NetSuiteError } from "./client";
import { filtrosSchema, parseFiltrosGuardados, type Filtro } from "./filtros";
import { descubrirCampos } from "./descubrir";

const PATH = "/ingresos/export-bancos";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type CampoRow = Database["export_bancos"]["Tables"]["campos"]["Row"];

const CAMPO_COLS = "id, tabla, campo, modo, etiqueta, tipo, habilitado, orden";

function toCampo(r: Pick<CampoRow, "id" | "tabla" | "campo" | "modo" | "etiqueta" | "tipo" | "habilitado" | "orden">): CampoCatalogo {
  return {
    id: r.id,
    tabla: r.tabla as CampoCatalogo["tabla"],
    campo: r.campo,
    modo: r.modo as CampoCatalogo["modo"],
    etiqueta: r.etiqueta,
    tipo: r.tipo as CampoCatalogo["tipo"],
    habilitado: r.habilitado,
    orden: r.orden,
  };
}

const etiquetaSchema = z
  .string()
  .trim()
  .min(1, "La etiqueta no puede estar vacía")
  .max(80, "Máximo 80 caracteres");
const nombrePlantillaSchema = z
  .string()
  .trim()
  .min(2, "El nombre debe tener al menos 2 caracteres")
  .max(80, "Máximo 80 caracteres");
const idsSchema = z.array(z.uuid()).min(1, "Selecciona al menos un campo").max(500);
const nuevoCampoSchema = z
  .object({
    tabla: z.enum(TABLAS),
    campo: z.string().regex(CAMPO_RE, "Nombre de campo inválido"),
    modo: z.enum(["valor", "texto"]),
    etiqueta: etiquetaSchema,
    tipo: z.enum(TIPOS),
  })
  .refine((c) => c.modo === "valor" || c.tipo === "text", {
    message: "Los campos con nombre visible (BUILTIN.DF) son de tipo texto",
  })
  .refine((c) => c.tabla !== "ter" || (c.campo in CAMPOS_TERCERO && c.modo === "valor"), {
    message: "Los campos de Tercero son fijos: documento o nombre",
  });

const SESION_EXPIRADA = "Tu sesión expiró. Vuelve a iniciar sesión.";

function dbError(message: string, code?: string): string {
  if (code === "23505") return "Ya existe un registro con ese nombre o campo.";
  if (code === "42501") return "No tienes permisos para esta operación.";
  if (code === "42P01") return "Falta aplicar la migración de campos de la exportación.";
  return message;
}

function primerError(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

async function sesion() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) return { supabase, userId: null, roles: null };
  return { supabase, userId, roles: await getUserRoles(userId) };
}

async function requireAdminAction() {
  const s = await sesion();
  if (!s.userId || !s.roles) return { ...s, error: SESION_EXPIRADA };
  if (!isAdmin(s.roles)) return { ...s, error: "Solo un administrador puede editar el catálogo de campos." };
  return { ...s, error: null };
}

async function requireIngresosAction() {
  const s = await sesion();
  if (!s.userId || !s.roles) return { ...s, error: SESION_EXPIRADA };
  if (!hasIngresosOrAdmin(s.roles)) return { ...s, error: "No tienes permisos para esta exportación." };
  return { ...s, error: null };
}

// ---------------------------------------------------------------------------
// Lectura

export interface CamposData {
  campos: CampoCatalogo[];
  plantillas: Plantilla[];
}

/** Catálogo (completo para admin; solo habilitados para el resto) y plantillas. */
export async function getCamposData(admin: boolean): Promise<CamposData> {
  const supabase = await createClient();
  let camposQuery = supabase.schema("export_bancos").from("campos").select(CAMPO_COLS).order("orden").order("created_at");
  if (!admin) camposQuery = camposQuery.eq("habilitado", true);
  const [camposRes, plantillasRes] = await Promise.all([
    camposQuery,
    supabase.schema("export_bancos").from("plantillas").select("id, nombre, campos, filtros, updated_at").order("nombre"),
  ]);
  const error = camposRes.error ?? plantillasRes.error;
  if (error) throw new Error(dbError(error.message, error.code));
  return {
    campos: (camposRes.data ?? []).map(toCampo),
    plantillas: (plantillasRes.data ?? []).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      campos: p.campos,
      filtros: parseFiltrosGuardados(p.filtros),
      updatedAt: p.updated_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Catálogo (admin)

export async function descubrirCamposAction(): Promise<ActionResult<CampoDescubierto[]>> {
  const { supabase, error } = await requireAdminAction();
  if (error) return { ok: false, error };

  const { data, error: dbErr } = await supabase.schema("export_bancos").from("campos").select("tabla, campo, modo");
  if (dbErr) return { ok: false, error: dbError(dbErr.message, dbErr.code) };
  const existentes = new Set(
    (data ?? []).map((c) => claveCampo(c as Pick<CampoCatalogo, "tabla" | "campo" | "modo">)),
  );

  try {
    return { ok: true, data: await descubrirCampos(existentes) };
  } catch (err) {
    console.error("[export-bancos] descubrir campos", err);
    if (err instanceof NetSuiteError) return { ok: false, error: err.message };
    return { ok: false, error: "No se pudieron consultar los campos en NetSuite." };
  }
}

export async function agregarCampos(
  nuevos: Pick<CampoDescubierto, "tabla" | "campo" | "modo" | "etiqueta" | "tipo">[],
): Promise<ActionResult<CampoCatalogo[]>> {
  const parsed = z.array(nuevoCampoSchema).min(1, "Selecciona al menos un campo").max(200).safeParse(nuevos);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error, "Campos inválidos") };
  const { supabase, error } = await requireAdminAction();
  if (error) return { ok: false, error };

  const { data: last } = await supabase
    .schema("export_bancos").from("campos")
    .select("orden")
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = last?.orden ?? 0;

  const { data, error: dbErr } = await supabase
    .schema("export_bancos").from("campos")
    .insert(parsed.data.map((c, i) => ({ ...c, orden: base + i + 1 })))
    .select(CAMPO_COLS);
  if (dbErr) return { ok: false, error: dbError(dbErr.message, dbErr.code) };

  revalidatePath(PATH);
  return { ok: true, data: (data ?? []).map(toCampo) };
}

export async function actualizarCampo(
  id: string,
  patch: { etiqueta?: string; tipo?: CampoCatalogo["tipo"]; habilitado?: boolean },
): Promise<ActionResult> {
  const update: { etiqueta?: string; tipo?: string; habilitado?: boolean; updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (patch.etiqueta !== undefined) {
    const parsed = etiquetaSchema.safeParse(patch.etiqueta);
    if (!parsed.success) return { ok: false, error: primerError(parsed.error, "Etiqueta inválida") };
    update.etiqueta = parsed.data;
  }
  if (patch.tipo !== undefined) {
    if (!(TIPOS as readonly string[]).includes(patch.tipo)) return { ok: false, error: "Tipo inválido" };
    update.tipo = patch.tipo;
  }
  if (patch.habilitado !== undefined) update.habilitado = patch.habilitado;

  const { supabase, error } = await requireAdminAction();
  if (error) return { ok: false, error };
  const { error: dbErr } = await supabase.schema("export_bancos").from("campos").update(update).eq("id", id);
  if (dbErr) {
    if (dbErr.code === "23514") {
      return { ok: false, error: "Los campos con nombre visible (BUILTIN.DF) solo pueden ser texto." };
    }
    return { ok: false, error: dbError(dbErr.message, dbErr.code) };
  }

  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

/** Guarda el orden de columnas del catálogo (ids en el orden deseado). */
export async function ordenarCampos(ids: string[]): Promise<ActionResult> {
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error, "Orden inválido") };
  const { supabase, error } = await requireAdminAction();
  if (error) return { ok: false, error };

  const now = new Date().toISOString();
  const results = await Promise.all(
    parsed.data.map((id, i) =>
      supabase.schema("export_bancos").from("campos").update({ orden: i + 1, updated_at: now }).eq("id", id),
    ),
  );
  const dbErr = results.find((r) => r.error)?.error;
  if (dbErr) return { ok: false, error: dbError(dbErr.message, dbErr.code) };

  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Plantillas (equipo de ingresos)

export async function crearPlantilla(
  nombre: string,
  campos: string[],
  filtros: Filtro[] = [],
): Promise<ActionResult<Plantilla>> {
  const n = nombrePlantillaSchema.safeParse(nombre);
  if (!n.success) return { ok: false, error: primerError(n.error, "Nombre inválido") };
  const c = idsSchema.safeParse(campos);
  if (!c.success) return { ok: false, error: primerError(c.error, "Campos inválidos") };
  const f = filtrosSchema.safeParse(filtros);
  if (!f.success) return { ok: false, error: primerError(f.error, "Filtros inválidos") };
  const { supabase, error } = await requireIngresosAction();
  if (error) return { ok: false, error };

  const { data, error: dbErr } = await supabase
    .schema("export_bancos").from("plantillas")
    .insert({ nombre: n.data, campos: c.data, filtros: f.data as Json })
    .select("id, nombre, campos, filtros, updated_at")
    .single();
  if (dbErr) return { ok: false, error: dbError(dbErr.message, dbErr.code) };

  revalidatePath(PATH);
  return {
    ok: true,
    data: {
      id: data.id,
      nombre: data.nombre,
      campos: data.campos,
      filtros: parseFiltrosGuardados(data.filtros),
      updatedAt: data.updated_at,
    },
  };
}

export async function actualizarPlantilla(
  id: string,
  patch: { nombre?: string; campos?: string[]; filtros?: Filtro[] },
): Promise<ActionResult> {
  const { supabase, userId, error } = await requireIngresosAction();
  if (error) return { ok: false, error };
  const update: {
    nombre?: string;
    campos?: string[];
    filtros?: Json;
    updated_at: string;
    updated_by: string;
  } = {
    updated_at: new Date().toISOString(),
    updated_by: userId!,
  };
  if (patch.nombre !== undefined) {
    const n = nombrePlantillaSchema.safeParse(patch.nombre);
    if (!n.success) return { ok: false, error: primerError(n.error, "Nombre inválido") };
    update.nombre = n.data;
  }
  if (patch.campos !== undefined) {
    const c = idsSchema.safeParse(patch.campos);
    if (!c.success) return { ok: false, error: primerError(c.error, "Campos inválidos") };
    update.campos = c.data;
  }
  if (patch.filtros !== undefined) {
    const f = filtrosSchema.safeParse(patch.filtros);
    if (!f.success) return { ok: false, error: primerError(f.error, "Filtros inválidos") };
    update.filtros = f.data as Json;
  }

  const { error: dbErr } = await supabase.schema("export_bancos").from("plantillas").update(update).eq("id", id);
  if (dbErr) return { ok: false, error: dbError(dbErr.message, dbErr.code) };

  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function eliminarPlantilla(id: string): Promise<ActionResult> {
  const { supabase, error } = await requireIngresosAction();
  if (error) return { ok: false, error };
  const { error: dbErr } = await supabase.schema("export_bancos").from("plantillas").delete().eq("id", id);
  if (dbErr) return { ok: false, error: dbError(dbErr.message, dbErr.code) };

  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

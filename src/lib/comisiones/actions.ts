"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { autorizar } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import type { Json } from "@/types/supabase";

import {
  PREFIJOS_COMISION,
  type Asiento,
  type BasePeriodo,
  type CierreGuardado,
  type Concepto,
  type Control,
  type FuenteReconocimiento,
  type GastoRegistrado,
  type PrefijoComision,
  type Reconocimiento,
  type ValorPeriodo,
} from "./types";

const PATH = "/ingresos-egresos/calculo-comisiones";

const periodoSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Periodo inválido");
const prefijoSchema = z.enum(PREFIJOS_COMISION);
const nombreSchema = z
  .string()
  .trim()
  .min(2, "El nombre debe tener al menos 2 caracteres")
  .max(80, "Máximo 80 caracteres");
const cuentaSchema = z
  .string()
  .trim()
  .regex(/^\d{4,12}$/, "La cuenta debe tener solo dígitos (4 a 12)");
const montoSchema = z
  .number()
  .finite()
  .min(0, "El valor no puede ser negativo")
  .max(1e15, "Valor demasiado grande");
/** Comisiones: pueden ser negativas (reversiones de incentivos, p. ej.). */
const comisionSchema = z.number().finite().min(-1e15).max(1e15, "Valor demasiado grande");
const ingresoSchema = z.number().finite().min(-1e15).max(1e15);

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ComisionesData {
  conceptos: Concepto[];
  valores: ValorPeriodo[];
  bases: BasePeriodo[];
  reconocimientos: Reconocimiento[];
  registrados: GastoRegistrado[];
  cierres: CierreGuardado[];
}

export async function getComisionesData(): Promise<ComisionesData> {
  const acceso = await autorizar(PROCESOS.CALCULO_COMISIONES, "ver");
  if (!acceso.ok) throw new Error(acceso.error);
  const { supabase } = acceso;

  const [conceptosRes, valoresRes, basesRes, reconRes, registradosRes, cierresRes] = await Promise.all([
    supabase
      .schema("comisiones").from("conceptos")
      .select("id, nombre, cuenta, activo, orden")
      .order("orden")
      .order("created_at"),
    supabase.schema("comisiones").from("periodo_valores").select("periodo, concepto_id, valor"),
    supabase.schema("comisiones").from("bases").select("periodo, prefijo, facturas, notas_credito"),
    supabase
      .schema("comisiones").from("reconocimientos")
      .select("cohorte, periodo, prefijo, ingreso, pendiente_ingreso, fuente"),
    supabase
      .schema("comisiones").from("gasto_registrado")
      .select("cohorte, periodo, concepto_id, gasto, motivo"),
    supabase
      .schema("comisiones").from("cierres")
      .select("*")
      .order("periodo", { ascending: false }),
  ]);

  const error =
    conceptosRes.error ??
    valoresRes.error ??
    basesRes.error ??
    reconRes.error ??
    registradosRes.error ??
    cierresRes.error;
  if (error) {
    throw new Error(`No se pudieron cargar las comisiones: ${error.message}`);
  }

  return {
    conceptos: conceptosRes.data ?? [],
    valores: (valoresRes.data ?? []).map((v) => ({
      periodo: v.periodo,
      conceptoId: v.concepto_id,
      valor: Number(v.valor),
    })),
    bases: (basesRes.data ?? []).map((b) => ({
      periodo: b.periodo,
      prefijo: b.prefijo as PrefijoComision,
      facturas: Number(b.facturas),
      notasCredito: Number(b.notas_credito),
    })),
    reconocimientos: (reconRes.data ?? []).map((r) => ({
      cohorte: r.cohorte,
      periodo: r.periodo,
      prefijo: r.prefijo as PrefijoComision,
      ingreso: Number(r.ingreso),
      pendienteIngreso: r.pendiente_ingreso === null ? null : Number(r.pendiente_ingreso),
      fuente: r.fuente as FuenteReconocimiento,
    })),
    registrados: (registradosRes.data ?? []).map((g) => ({
      cohorte: g.cohorte,
      periodo: g.periodo,
      conceptoId: g.concepto_id,
      gasto: Number(g.gasto),
      motivo: g.motivo,
    })),
    cierres: (cierresRes.data ?? []).map((c) => ({
      id: c.id,
      periodo: c.periodo,
      archivoNombre: c.archivo_nombre,
      archivoTamano: Number(c.archivo_tamano),
      gastoMes: Number(c.gasto_mes),
      diferidoNuevo: Number(c.diferido_nuevo),
      saldoDiferido: Number(c.saldo_diferido),
      asientos: c.asientos as unknown as Asiento[],
      controles: c.controles as unknown as Control[],
      createdAt: c.created_at,
    })),
  };
}

function dbError(message: string, code?: string): string {
  if (code === "23505") return "Ya existe un concepto con ese nombre.";
  if (code === "42501") return "No tienes permisos para modificar comisiones.";
  return message;
}

function primerError(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

// ---------------------------------------------------------------------------
// Conceptos

export async function crearConcepto(nombre: string): Promise<ActionResult<Concepto>> {
  const parsed = nombreSchema.safeParse(nombre);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error, "Nombre inválido") };
  const acceso = await autorizar(PROCESOS.CALCULO_COMISIONES, "usar");
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const { supabase } = acceso;

  const { data: last } = await supabase
    .schema("comisiones").from("conceptos")
    .select("orden")
    .order("orden", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .schema("comisiones").from("conceptos")
    .insert({ nombre: parsed.data, orden: (last?.orden ?? 0) + 1 })
    .select("id, nombre, cuenta, activo, orden")
    .single();
  if (error) return { ok: false, error: dbError(error.message, error.code) };

  revalidatePath(PATH);
  return { ok: true, data };
}

export async function actualizarConcepto(
  id: string,
  patch: { nombre?: string; activo?: boolean; cuenta?: string | null },
): Promise<ActionResult> {
  const update: { nombre?: string; activo?: boolean; cuenta?: string | null; updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (patch.nombre !== undefined) {
    const parsed = nombreSchema.safeParse(patch.nombre);
    if (!parsed.success) return { ok: false, error: primerError(parsed.error, "Nombre inválido") };
    update.nombre = parsed.data;
  }
  if (patch.cuenta !== undefined) {
    if (patch.cuenta === null || patch.cuenta.trim() === "") {
      update.cuenta = null;
    } else {
      const parsed = cuentaSchema.safeParse(patch.cuenta);
      if (!parsed.success) return { ok: false, error: primerError(parsed.error, "Cuenta inválida") };
      update.cuenta = parsed.data;
    }
  }
  if (patch.activo !== undefined) update.activo = patch.activo;

  const acceso = await autorizar(PROCESOS.CALCULO_COMISIONES, "usar");
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const { supabase } = acceso;

  const { error } = await supabase.schema("comisiones").from("conceptos").update(update).eq("id", id);
  if (error) return { ok: false, error: dbError(error.message, error.code) };

  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function guardarValores(
  periodo: string,
  valores: { conceptoId: string; valor: number }[],
): Promise<ActionResult> {
  const p = periodoSchema.safeParse(periodo);
  if (!p.success) return { ok: false, error: "Periodo inválido" };
  for (const v of valores) {
    const parsed = comisionSchema.safeParse(v.valor);
    if (!parsed.success) return { ok: false, error: primerError(parsed.error, "Valor inválido") };
  }
  if (valores.length === 0) return { ok: true, data: undefined };

  const acceso = await autorizar(PROCESOS.CALCULO_COMISIONES, "usar");
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const { supabase, userId } = acceso;

  const now = new Date().toISOString();
  const { error } = await supabase.schema("comisiones").from("periodo_valores").upsert(
    valores.map((v) => ({
      periodo: p.data,
      concepto_id: v.conceptoId,
      valor: Math.round(v.valor * 100) / 100,
      updated_at: now,
      updated_by: userId,
    })),
    { onConflict: "periodo,concepto_id" },
  );
  if (error) return { ok: false, error: dbError(error.message, error.code) };

  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Facturación del mes

export async function guardarBase(base: BasePeriodo): Promise<ActionResult> {
  const p = periodoSchema.safeParse(base.periodo);
  const pre = prefijoSchema.safeParse(base.prefijo);
  if (!p.success || !pre.success) return { ok: false, error: "Periodo o prefijo inválido" };
  for (const v of [base.facturas, base.notasCredito]) {
    const parsed = montoSchema.safeParse(v);
    if (!parsed.success) return { ok: false, error: primerError(parsed.error, "Valor inválido") };
  }

  const acceso = await autorizar(PROCESOS.CALCULO_COMISIONES, "usar");
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const { supabase, userId } = acceso;

  const { error } = await supabase.schema("comisiones").from("bases").upsert(
    {
      periodo: p.data,
      prefijo: pre.data,
      facturas: Math.round(base.facturas * 100) / 100,
      notas_credito: Math.round(base.notasCredito * 100) / 100,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    },
    { onConflict: "periodo,prefijo" },
  );
  if (error) return { ok: false, error: dbError(error.message, error.code) };

  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Cierres

export interface GuardarCierreInput {
  periodo: string;
  archivoNombre: string;
  archivoTamano: number;
  /** Ingreso del mes y pendiente por diferir, por cohorte y prefijo, en pesos. */
  reconocimientos: {
    cohorte: string;
    prefijo: PrefijoComision;
    ingreso: number;
    pendienteIngreso: number;
  }[];
  gastoMes: number;
  diferidoNuevo: number;
  saldoDiferido: number;
  asientos: Asiento[];
  controles: Control[];
}

const reconocimientoSchema = z.object({
  cohorte: periodoSchema,
  prefijo: prefijoSchema,
  ingreso: ingresoSchema,
  pendienteIngreso: ingresoSchema,
});

export async function guardarCierre(input: GuardarCierreInput): Promise<ActionResult> {
  const p = periodoSchema.safeParse(input.periodo);
  if (!p.success) return { ok: false, error: "Periodo inválido" };
  const recon = z.array(reconocimientoSchema).safeParse(input.reconocimientos);
  if (!recon.success) return { ok: false, error: "El ingreso por cohorte no es válido." };
  if (recon.data.some((r) => r.cohorte > p.data)) {
    return { ok: false, error: "El informe trae facturas posteriores al periodo." };
  }

  const acceso = await autorizar(PROCESOS.CALCULO_COMISIONES, "usar");
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const { supabase } = acceso;

  const { error } = await supabase.schema("comisiones").rpc("guardar_cierre", {
    p_periodo: p.data,
    p_reconocimientos: recon.data.map((r) => ({
      cohorte: r.cohorte,
      prefijo: r.prefijo,
      ingreso: Math.round(r.ingreso * 100) / 100,
      pendiente_ingreso: Math.round(r.pendienteIngreso * 100) / 100,
    })) as unknown as Json,
    p_cierre: {
      archivoNombre: input.archivoNombre.slice(0, 255),
      archivoTamano: input.archivoTamano,
      gastoMes: input.gastoMes,
      diferidoNuevo: input.diferidoNuevo,
      saldoDiferido: input.saldoDiferido,
      asientos: input.asientos,
      controles: input.controles,
    } as unknown as Json,
  });
  if (error) return { ok: false, error: dbError(error.message, error.code) };

  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

export async function eliminarCierre(periodo: string): Promise<ActionResult> {
  const p = periodoSchema.safeParse(periodo);
  if (!p.success) return { ok: false, error: "Periodo inválido" };

  const acceso = await autorizar(PROCESOS.CALCULO_COMISIONES, "usar");
  if (!acceso.ok) return { ok: false, error: acceso.error };
  const { supabase } = acceso;

  const { error } = await supabase.schema("comisiones").from("cierres").delete().eq("periodo", p.data);
  if (error) return { ok: false, error: dbError(error.message, error.code) };

  // El ingreso leído del informe para ese mes se va con el cierre; el
  // histórico cargado desde el Excel se conserva.
  const { error: e2 } = await supabase
    .schema("comisiones").from("reconocimientos")
    .delete()
    .eq("periodo", p.data)
    .eq("fuente", "informe");
  if (e2) return { ok: false, error: dbError(e2.message, e2.code) };

  revalidatePath(PATH);
  return { ok: true, data: undefined };
}

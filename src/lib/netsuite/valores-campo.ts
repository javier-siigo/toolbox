import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/supabase";

import { JOINS_TERCERO, type CampoCatalogo } from "./campos";
import {
  NetSuiteError,
  getAccessToken,
  netsuiteConfig,
  suiteQLPageInfo,
  tiposDeRegistro,
  type NetSuiteConfig,
} from "./client";
import { FROM_BANCOS } from "./export-bancos";
import { MAX_OPCIONES, VENTANA_DIAS, VIGENCIA_DIAS } from "./filtros";
import { SOLO_BANCOS, esCampoTipoCuenta, expresionLista } from "./filtros-sql";
import {
  NOMBRES_PERSONALIZADOS,
  PREFIJO_PERSONALIZADO,
  TIPOS_ESTANDAR,
  esCampoTipo,
  esTipoPersonalizado,
} from "./tipos-documento";

/**
 * Valores posibles de un campo para el filtro de lista.
 *
 * Los valores casi nunca cambian (tipos de documento, monedas, cuentas…), así
 * que no se consultan en cada apertura: se calculan sobre los últimos
 * `VENTANA_DIAS` días y se guardan en `netsuite_campo_valores`. Pasados
 * `VIGENCIA_DIAS` se sirven igual y se refrescan en segundo plano.
 *
 * Por cada semana van dos consultas: conteos (`GROUP BY` del campo) y
 * nombres (`DISTINCT` con `BUILTIN.DF`). Juntas no funcionan: DF dentro de un
 * GROUP BY y `MIN(t.id)` en la agregada hacen que NetSuite responda 500. Si
 * una semana falla se reintenta día por día.
 */

const TRAMO_DIAS = 7;
const CONCURRENCIA = 3;
const DEADLINE_MS = 110_000;
/** Filas por consulta: una sola página de SuiteQL. */
const FILAS_MAX = 1000;

export interface OpcionFiltro {
  /** Valor crudo (null = vacío). */
  v: string | null;
  /** Nombre visible. */
  l: string;
  /** Filas con ese valor en la ventana. */
  n: number;
}

export interface ValoresCampo {
  opciones: OpcionFiltro[];
  /** Valores distintos vistos (puede superar las opciones guardadas). */
  distintos: number;
  /** Hay más valores de los guardados: usar la búsqueda de texto. */
  truncado: boolean;
  /** Días de la ventana que NetSuite no pudo responder. */
  diasSinDatos: number;
  desde: string;
  hasta: string;
  actualizadoAt: string;
}

export function vencido(v: Pick<ValoresCampo, "actualizadoAt">): boolean {
  return Date.now() - new Date(v.actualizadoAt).getTime() > VIGENCIA_DIAS * 86_400_000;
}

export async function leerValoresGuardados(campoId: string): Promise<ValoresCampo | null> {
  const { data, error } = await createAdminClient()
    .schema("export_bancos").from("campo_valores")
    .select("valores, distintos, truncado, dias_sin_datos, desde, hasta, actualizado_at")
    .eq("campo_id", campoId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la caché de valores: ${error.message}`);
  if (!data) return null;
  return {
    opciones: data.valores as unknown as OpcionFiltro[],
    distintos: data.distintos,
    truncado: data.truncado,
    diasSinDatos: data.dias_sin_datos,
    desde: data.desde,
    hasta: data.hasta,
    actualizadoAt: data.actualizado_at,
  };
}

// Un refresco por campo a la vez en esta instancia.
const enCurso = new Map<string, Promise<ValoresCampo>>();

/** Consulta NetSuite y guarda el resultado. */
export function refrescarValores(campo: CampoCatalogo, signal?: AbortSignal): Promise<ValoresCampo> {
  const previo = enCurso.get(campo.id);
  if (previo) return previo;
  const p = calcularYGuardar(campo, signal).finally(() => enCurso.delete(campo.id));
  enCurso.set(campo.id, p);
  return p;
}

async function calcularYGuardar(campo: CampoCatalogo, signal?: AbortSignal): Promise<ValoresCampo> {
  const valores = await calcularValores(campo, signal);
  const { error } = await createAdminClient()
    .schema("export_bancos").from("campo_valores")
    .upsert({
      campo_id: campo.id,
      valores: valores.opciones as unknown as Json,
      distintos: valores.distintos,
      truncado: valores.truncado,
      dias_sin_datos: valores.diasSinDatos,
      desde: valores.desde,
      hasta: valores.hasta,
      actualizado_at: valores.actualizadoAt,
    });
  if (error) console.error("[valores-campo] no se pudo guardar la caché", error);
  return valores;
}

function isoDia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Tramos [inicio, fin] de `TRAMO_DIAS` días que cubren la ventana. */
function tramos(hasta: Date): { inicio: string; fin: string; dias: string[] }[] {
  const out: { inicio: string; fin: string; dias: string[] }[] = [];
  for (let i = 0; i < VENTANA_DIAS; i += TRAMO_DIAS) {
    const dias: string[] = [];
    for (let j = i; j < Math.min(i + TRAMO_DIAS, VENTANA_DIAS); j++) {
      dias.push(isoDia(new Date(hasta.getTime() - j * 86_400_000)));
    }
    out.push({ inicio: dias[dias.length - 1]!, fin: dias[0]!, dias });
  }
  return out;
}

type Tramo = { conteos: Map<string | null, number>; nombres: Map<string, Set<string>>; truncado: boolean };

function valorCrudo(v: unknown): string | null {
  return v === undefined || v === null || v === "" ? null : String(v);
}

async function leerTramo(
  config: NetSuiteConfig,
  token: string,
  campo: CampoCatalogo,
  inicio: string,
  fin: string,
  signal: AbortSignal,
): Promise<Tramo> {
  // Las listas se arman sobre líneas de bancos: es lo que se exporta por
  // defecto y agrupar todas las cuentas (millones de filas) no responde.
  const joins = campo.tabla === "ter" ? JOINS_TERCERO : "";
  const from = `${FROM_BANCOS.replace("\nWHERE", `${joins}\nWHERE`)}${SOLO_BANCOS}
  AND t.trandate BETWEEN TO_DATE('${inicio}','YYYY-MM-DD') AND TO_DATE('${fin}','YYYY-MM-DD')`;

  if (esCampoTipo(campo)) {
    // Los personalizados comparten t.type = 'Custom': se cuentan por recordtype.
    const res = await suiteQLPageInfo(
      config,
      token,
      `SELECT t.type AS v, t.recordtype AS rt, COUNT(*) AS n
${from}
GROUP BY t.type, t.recordtype`,
      FILAS_MAX,
      signal,
    );
    const conteos = new Map<string | null, number>();
    for (const it of res.items) {
      const v = valorCrudo(it.v) === "Custom" ? valorCrudo(it.rt) : valorCrudo(it.v);
      conteos.set(v, (conteos.get(v) ?? 0) + Number(it.n ?? 0));
    }
    return { conteos, nombres: new Map(), truncado: false };
  }

  const expr = expresionLista(campo);
  const agregada = await suiteQLPageInfo(
    config,
    token,
    `SELECT ${expr} AS v, COUNT(*) AS n
${from}
GROUP BY ${expr}`,
    FILAS_MAX,
    signal,
  );
  const conteos = new Map<string | null, number>();
  for (const it of agregada.items) conteos.set(valorCrudo(it.v), Number(it.n ?? 0));
  let truncado = (agregada.total ?? 0) > agregada.items.length;

  // Nombres visibles solo en campos de texto. Un código puede tener varios
  // (el estado "C" es "Pago : Depositado" y "Venta de Contado : Depositada").
  const nombres = new Map<string, Set<string>>();
  if (campo.tipo === "text") {
    const res = await suiteQLPageInfo(
      config,
      token,
      `SELECT DISTINCT ${expr} AS v, BUILTIN.DF(${expr}) AS l
${from}`,
      FILAS_MAX,
      signal,
    );
    truncado ||= (res.total ?? 0) > res.items.length;
    for (const it of res.items) {
      const v = valorCrudo(it.v);
      if (v === null || it.l === undefined || it.l === null) continue;
      const l = String(it.l);
      if (l === v) continue;
      const set = nombres.get(v) ?? new Set<string>();
      set.add(l);
      nombres.set(v, set);
    }
  }
  return { conteos, nombres, truncado };
}

/** Error de la consulta en sí (el 500 de NetSuite), no de red ni de sesión. */
function esErrorDeConsulta(err: unknown) {
  return err instanceof NetSuiteError && err.code === "netsuite_query";
}

async function calcularValores(campo: CampoCatalogo, externo?: AbortSignal): Promise<ValoresCampo> {
  const signal = AbortSignal.any(
    [AbortSignal.timeout(DEADLINE_MS), externo].filter((s): s is AbortSignal => s !== undefined),
  );
  const config = netsuiteConfig();
  const token = await getAccessToken(config, signal);
  // Hasta ayer: el día en curso todavía cambia.
  const hasta = new Date(Date.now() - 86_400_000);

  if (esCampoTipoCuenta(campo)) {
    // Lista fija y corta: se lee de la tabla de cuentas, sin transacciones.
    const res = await suiteQLPageInfo(
      config,
      token,
      `SELECT DISTINCT a.accttype AS v, BUILTIN.DF(a.accttype) AS l FROM account a`,
      FILAS_MAX,
      signal,
    );
    const opciones = res.items
      .map((it) => ({ v: valorCrudo(it.v), l: String(it.l ?? it.v ?? ""), n: 0 }))
      .filter((o): o is OpcionFiltro & { v: string } => o.v !== null)
      .sort((a, b) => a.l.localeCompare(b.l, "es"));
    return {
      opciones,
      distintos: opciones.length,
      truncado: false,
      diasSinDatos: 0,
      desde: isoDia(new Date(hasta.getTime() - (VENTANA_DIAS - 1) * 86_400_000)),
      hasta: isoDia(hasta),
      actualizadoAt: new Date().toISOString(),
    };
  }
  const pendientes = tramos(hasta);

  const conteos = new Map<string | null, number>();
  const nombres = new Map<string, Set<string>>();
  let truncado = false;
  let diasSinDatos = 0;
  let ultimoError: unknown = null;

  const sumar = (t: Tramo) => {
    truncado ||= t.truncado;
    for (const [v, n] of t.conteos) conteos.set(v, (conteos.get(v) ?? 0) + n);
    for (const [v, ls] of t.nombres) {
      const set = nombres.get(v) ?? new Set<string>();
      for (const l of ls) set.add(l);
      nombres.set(v, set);
    }
  };

  const trabajar = async () => {
    for (let t = pendientes.shift(); t; t = pendientes.shift()) {
      try {
        sumar(await leerTramo(config, token, campo, t.inicio, t.fin, signal));
      } catch (err) {
        if (!esErrorDeConsulta(err)) throw err;
        // La semana completa falló: se intenta día por día.
        for (const dia of t.dias) {
          try {
            sumar(await leerTramo(config, token, campo, dia, dia, signal));
          } catch (errDia) {
            if (!esErrorDeConsulta(errDia)) throw errDia;
            ultimoError = errDia;
            diasSinDatos++;
          }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCIA }, trabajar));

  if (diasSinDatos >= VENTANA_DIAS && ultimoError) throw ultimoError;

  const ventana = {
    diasSinDatos,
    desde: isoDia(new Date(hasta.getTime() - (VENTANA_DIAS - 1) * 86_400_000)),
    hasta: isoDia(hasta),
    actualizadoAt: new Date().toISOString(),
  };
  if (esCampoTipo(campo)) {
    const opciones = await opcionesTipo(config, token, conteos, signal);
    return { opciones, distintos: opciones.length, truncado: false, ...ventana };
  }

  const opciones = [...conteos.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_OPCIONES)
    .map(([v, n]) => {
      let l = v ?? "";
      if (v !== null && nombres.has(v)) l = [...nombres.get(v)!].sort().join(" · ");
      if (campo.tipo === "boolean") l = v === "T" ? "Sí" : v === "F" ? "No" : l;
      return { v, l, n };
    });

  return {
    opciones,
    distintos: conteos.size,
    truncado: truncado || conteos.size > MAX_OPCIONES,
    ...ventana,
  };
}

/**
 * Todos los tipos de documento de la cuenta, en orden alfabético como en
 * NetSuite, aunque no tengan movimientos: los estándar de la lista fija y
 * los personalizados del catálogo de registros, con su nombre leído de las
 * transacciones (o de `NOMBRES_PERSONALIZADOS` si nunca se usaron).
 */
async function opcionesTipo(
  config: NetSuiteConfig,
  token: string,
  conteos: Map<string | null, number>,
  signal: AbortSignal,
): Promise<OpcionFiltro[]> {
  const nombres = new Map<string, string>(TIPOS_ESTANDAR.map((t) => [t.v, t.l]));

  const personalizados = new Set<string>();
  try {
    for (const n of await tiposDeRegistro(config, token, signal)) {
      if (esTipoPersonalizado(n)) personalizados.add(n);
    }
  } catch (err) {
    // Sin catálogo quedan los personalizados que tienen transacciones.
    if (!esErrorDeConsulta(err)) throw err;
  }
  const usados = await suiteQLPageInfo(
    config,
    token,
    `SELECT DISTINCT t.recordtype AS v, BUILTIN.DF(t.type) AS l FROM transaction t WHERE t.type = 'Custom'`,
    FILAS_MAX,
    signal,
  );
  for (const it of usados.items) {
    const v = valorCrudo(it.v);
    if (v === null) continue;
    personalizados.add(v);
    if (it.l !== undefined && it.l !== null) nombres.set(v, String(it.l));
  }
  for (const v of personalizados) {
    if (!nombres.has(v)) nombres.set(v, NOMBRES_PERSONALIZADOS[v] ?? v.slice(PREFIJO_PERSONALIZADO.length));
  }
  // Códigos con movimientos que no están en la lista fija.
  for (const v of conteos.keys()) if (v !== null && !nombres.has(v)) nombres.set(v, v);

  return [...nombres.entries()]
    .map(([v, l]) => ({ v, l, n: conteos.get(v) ?? 0 }))
    .sort((a, b) => a.l.localeCompare(b.l, "es"));
}

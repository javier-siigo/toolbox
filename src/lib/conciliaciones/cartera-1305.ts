import "server-only";

import { unstable_cache } from "next/cache";

import {
  NetSuiteError,
  PAGE_SIZE,
  SUITEQL_MAX_RESULTS,
  getAccessToken,
  netsuiteConfig,
  suiteQLPageAt,
  type NetSuiteConfig,
} from "@/lib/netsuite/client";

import type { Partida, Tercero } from "./cartera-1305-shared";

/**
 * Consultas SuiteQL de la Conciliación 1305. Cada función responde un tramo: el navegador
 * pide los tramos en paralelo, une las partidas y calcula (ver cartera-1305-shared.ts).
 * Todos los valores que entran al SQL llegan validados (fechas YYYY-MM-DD, ids numéricos).
 */

interface CuentaAR {
  id: string;
  numero: string;
}

/** Cuentas de movimiento 1305xx de tipo cuentas por cobrar, cacheadas 1 h. */
export const getCuentas1305 = unstable_cache(
  async (): Promise<CuentaAR[]> => {
    const filas = await consultar(
      "SELECT id, acctnumber FROM account WHERE acctnumber LIKE '1305%' AND issummary = 'F' AND accttype = 'AcctRec' ORDER BY id",
    );
    return filas
      .map((r) => ({ id: String(r.id ?? ""), numero: String(r.acctnumber ?? "") }))
      .filter((c) => /^\d+$/.test(c.id));
  },
  ["netsuite-cuentas-1305"],
  { revalidate: 3600 },
);

/** Consulta corta (cuentas, nombres de terceros): una sola página de hasta 1.000 filas. */
async function consultar(query: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const config: NetSuiteConfig = netsuiteConfig();
  const token = await getAccessToken(config, signal);
  const { items, total } = await suiteQLPageAt(config, token, query, 0, signal);
  if ((total ?? items.length) > PAGE_SIZE) {
    throw new NetSuiteError(`La consulta devolvió ${total} filas y se esperaban máximo ${PAGE_SIZE}.`, "netsuite_query");
  }
  return items;
}

/**
 * Todas las filas de una consulta de partidas, paginando **por llave** (la última
 * transacción y línea leídas) y no por posición. NetSuite se consulta en vivo: con
 * `offset`, si entre una página y otra se aplica o se cierra una partida, las filas se
 * corren un puesto y una queda por fuera (así se perdió una nota crédito de ~60.000 en
 * una corrida real). Con la llave cada página sigue exactamente donde terminó la anterior.
 * Las páginas van en serie: ~5 s cada una, un mes reciente (~13 páginas) en ~1 min.
 *
 * `armar` recibe la condición de llave para agregar al WHERE y debe ordenar por
 * `tal.transaction, tal.transactionline` (únicos por fila).
 */
async function consultarPorLlave(
  armar: (despues: string) => string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>[]> {
  const config: NetSuiteConfig = netsuiteConfig();
  const token = await getAccessToken(config, signal);
  const filas: Record<string, unknown>[] = [];
  let despues = "1 = 1";
  for (;;) {
    const { items } = await suiteQLPageAt(config, token, armar(despues), 0, signal);
    filas.push(...items);
    if (items.length < PAGE_SIZE) return filas;
    if (filas.length >= SUITEQL_MAX_RESULTS) {
      throw new NetSuiteError(`El tramo supera ${SUITEQL_MAX_RESULTS} filas.`, "netsuite_limit");
    }
    const ultima = items[items.length - 1]!;
    const tid = Number(ultima.tid);
    const lid = Number(ultima.lid);
    if (!Number.isInteger(tid) || !Number.isInteger(lid)) {
      throw new NetSuiteError("NetSuite devolvió una fila sin transacción o línea.", "netsuite_query");
    }
    despues = `(tal.transaction > ${tid} OR (tal.transaction = ${tid} AND tal.transactionline > ${lid}))`;
  }
}

const fecha = (f: string) => `TO_DATE('${f}', 'YYYY-MM-DD')`;

/** `d/m/yyyy` de SuiteQL → `yyyy-mm-dd`. */
function iso(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}` : null;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const COLUMNAS = `tal.transaction AS tid, tal.transactionline AS lid, t.type, t.tranid, t.trandate, t.duedate,
  COALESCE(tl.entity, t.entity) AS entidad, tal.account, tal.amount,
  tal.amountunpaid AS porcobrar, tal.paymentamountunused AS sinaplicar`;

const BASE = (cuentas: CuentaAR[], subsidiaria: string) => `
  tal.accountingbook = 1 AND tal.posting = 'T'
  AND tal.account IN (${cuentas.map((c) => c.id).join(", ")})
  AND tl.subsidiary = ${subsidiaria}`;

function aPartida(r: Record<string, unknown>, numeroCuenta: Map<string, string>, devolver = 0): Partida {
  const monto = num(r.amount);
  return {
    tid: String(r.tid),
    lid: String(r.lid),
    tipo: String(r.type ?? ""),
    numero: String(r.tranid ?? ""),
    fecha: iso(r.trandate) ?? "",
    vence: iso(r.duedate),
    entidad: r.entidad === undefined || r.entidad === null ? null : String(r.entidad),
    cuenta: numeroCuenta.get(String(r.account)) ?? String(r.account ?? ""),
    monto,
    pendienteHoy: monto >= 0 ? num(r.porcobrar) : num(r.sinaplicar),
    devolver,
  };
}

async function contexto() {
  const cuentas = await getCuentas1305();
  if (cuentas.length === 0) throw new NetSuiteError("No se encontraron cuentas 1305 en NetSuite.", "netsuite_query");
  return { cuentas, numeroCuenta: new Map(cuentas.map((c) => [c.id, c.numero])) };
}

/** Partidas abiertas hoy con fecha en el tramo. */
export async function partidasAbiertas(
  subsidiaria: string,
  desde: string | null,
  hasta: string,
  signal?: AbortSignal,
): Promise<Partida[]> {
  const { cuentas, numeroCuenta } = await contexto();
  const rango = desde ? `t.trandate BETWEEN ${fecha(desde)} AND ${fecha(hasta)}` : `t.trandate <= ${fecha(hasta)}`;
  const filas = await consultarPorLlave(
    (despues) => `SELECT ${COLUMNAS}
FROM transactionaccountingline tal
JOIN transaction t ON t.id = tal.transaction
JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
WHERE ${BASE(cuentas, subsidiaria)}
  AND (tal.amountunpaid <> 0 OR tal.paymentamountunused <> 0)
  AND ${rango}
  AND ${despues}
ORDER BY tal.transaction, tal.transactionline`,
    signal,
  );
  return filas.map((r) => aPartida(r, numeroCuenta));
}

/**
 * Partidas con fecha hasta el corte que recibieron aplicaciones en el tramo (posterior al
 * corte), con lo aplicado en `devolver`. Dos lados: la partida como documento aplicado
 * (factura ← pago posterior) y como documento que aplica (nota crédito → factura posterior).
 */
export async function partidasConAplicaciones(
  subsidiaria: string,
  corte: string,
  desde: string,
  hasta: string,
  signal?: AbortSignal,
): Promise<Partida[]> {
  const { cuentas, numeroCuenta } = await contexto();
  const lado = (propio: "previous" | "next", otro: "previous" | "next") => (despues: string) => `
SELECT ${COLUMNAS}, SUM(l.foreignamount) AS devolver
FROM previoustransactionlinelink l
JOIN transactionaccountingline tal ON tal.transaction = l.${propio}doc AND tal.transactionline = l.${propio}line
JOIN transaction t ON t.id = tal.transaction
JOIN transactionline tl ON tl.transaction = tal.transaction AND tl.id = tal.transactionline
WHERE l.linktype = 'Payment'
  AND l.${propio}date <= ${fecha(corte)}
  AND l.${otro}date BETWEEN ${fecha(desde)} AND ${fecha(hasta)}
  AND ${BASE(cuentas, subsidiaria)}
  AND ${despues}
GROUP BY tal.transaction, tal.transactionline, t.type, t.tranid, t.trandate, t.duedate,
  COALESCE(tl.entity, t.entity), tal.account, tal.amount, tal.amountunpaid, tal.paymentamountunused
ORDER BY tal.transaction, tal.transactionline`;
  const [aplicadas, aplicantes] = await Promise.all([
    consultarPorLlave(lado("previous", "next"), signal),
    consultarPorLlave(lado("next", "previous"), signal),
  ]);
  return [...aplicadas, ...aplicantes].map((r) => aPartida(r, numeroCuenta, num(r.devolver)));
}

/** Nombre y KS Documento de los clientes. */
export async function terceros(ids: string[], signal?: AbortSignal): Promise<Tercero[]> {
  if (ids.length === 0) return [];
  const filas = await consultar(
    `SELECT id, BUILTIN.DF(id) AS nombre, custentity_ks_documento AS documento
FROM customer WHERE id IN (${ids.join(", ")}) ORDER BY id`,
    signal,
  );
  return filas.map((r) => ({
    id: String(r.id),
    nombre: String(r.nombre ?? ""),
    documento: String(r.documento ?? ""),
  }));
}

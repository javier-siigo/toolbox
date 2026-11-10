import "server-only";

import {
  NetSuiteError,
  PAGE_SIZE,
  getAccessToken,
  netsuiteConfig,
  suiteQLPageAt,
  suiteQLPageInfo,
} from "./client";

/**
 * Consola SuiteQL (solo admin): ejecuta una query escrita a mano y devuelve
 * las filas tal cual las entrega NetSuite, con un tope para no saturar el
 * navegador ni la función.
 */

/** Tope de filas al pedir "todas". Por encima, la consola corta y avisa. */
export const CONSOLA_MAX_FILAS = 25_000;
const PARALELO = 4;

export interface ResultadoConsola {
  filas: Record<string, unknown>[];
  columnas: string[];
  /** Total que reporta NetSuite para la query (puede superar `filas`). */
  total: number | null;
  truncado: boolean;
  duracionMs: number;
}

/** NetSuite agrega `links` a cada item; no es un dato de la query. */
function limpiar(items: Record<string, unknown>[]): Record<string, unknown>[] {
  return items.map(({ links: _links, ...resto }) => resto);
}

/** Unión de llaves en orden de aparición (SuiteQL omite los campos nulos por fila). */
function columnasDe(filas: Record<string, unknown>[]): string[] {
  const vistas = new Set<string>();
  for (const fila of filas) for (const k of Object.keys(fila)) vistas.add(k);
  return [...vistas];
}

export async function ejecutarConsola(
  query: string,
  limite: number | "todas",
  signal?: AbortSignal,
): Promise<ResultadoConsola> {
  const inicio = Date.now();
  const config = netsuiteConfig();
  const token = await getAccessToken(config, signal);

  if (limite !== "todas") {
    const { items, total } = await suiteQLPageInfo(config, token, query, limite, signal);
    const filas = limpiar(items);
    return {
      filas,
      columnas: columnasDe(filas),
      total: total ?? null,
      truncado: total !== undefined && total > filas.length,
      duracionMs: Date.now() - inicio,
    };
  }

  const primera = await suiteQLPageAt(config, token, query, 0, signal);
  const total = primera.total ?? primera.items.length;
  const objetivo = Math.min(total, CONSOLA_MAX_FILAS);
  const offsets: number[] = [];
  for (let o = PAGE_SIZE; o < objetivo; o += PAGE_SIZE) offsets.push(o);

  const paginas: Record<string, unknown>[][] = [primera.items];
  for (let i = 0; i < offsets.length; i += PARALELO) {
    const lote = await Promise.all(
      offsets.slice(i, i + PARALELO).map((o) => suiteQLPageAt(config, token, query, o, signal)),
    );
    for (const p of lote) paginas.push(p.items);
  }

  const filas = limpiar(paginas.flat().slice(0, CONSOLA_MAX_FILAS));
  if (filas.length === 0 && total > 0) {
    throw new NetSuiteError("NetSuite reportó filas pero no devolvió ninguna.", "netsuite_query");
  }
  return {
    filas,
    columnas: columnasDe(filas),
    total,
    truncado: total > filas.length,
    duracionMs: Date.now() - inicio,
  };
}

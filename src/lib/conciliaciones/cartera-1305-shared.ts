/**
 * Conciliación 1305 (cartera con saldo negativo por tercero): tipos, tramos y cálculo.
 * Seguro para cliente y servidor: no consulta nada.
 *
 * La antigüedad de AR "a fecha de" se reconstruye así:
 *   1. Partidas abiertas hoy en las cuentas 1305 (facturas sin pagar, créditos sin aplicar),
 *      con fecha hasta el corte. Se piden por tramos de fecha porque NetSuite tarda por rango.
 *   2. Se les devuelve lo aplicado DESPUÉS del corte: una aplicación cuenta en la fecha
 *      más tardía de sus dos documentos (un pago del 30/10 aplicado a una factura del 1/11
 *      estaba abierto el 31/10). Esto trae también partidas que hoy están cerradas.
 *   3. Se suma por tercero; los terceros con saldo < 0 se listan con sus documentos,
 *      sin las facturas de venta (la factura y el pago no se netean entre sí en el reporte).
 * Ver docs/procesos/02-conciliaciones.md → "Conciliación 1305".
 */

export const FECHA_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** NetSuite tiene transacciones desde el 31/10/2020: el primer tramo no tiene límite inferior. */
export const PRIMER_ANIO = 2020;
/** Ids de cliente por petición de nombres (cabe en un IN de SuiteQL). */
export const MAX_IDS_TERCEROS = 900;

export interface Tramo {
  /** `null` en el primer tramo: todo lo anterior a `hasta`. */
  desde: string | null;
  hasta: string;
  etiqueta: string;
}

/** Partida contable en una cuenta 1305 (una línea de un documento). */
export interface Partida {
  tid: string;
  lid: string;
  tipo: string;
  numero: string;
  fecha: string; // YYYY-MM-DD
  vence: string | null;
  entidad: string | null;
  cuenta: string;
  monto: number;
  /** Pendiente hoy: por cobrar (débitos) o sin aplicar (créditos), siempre positivo. */
  pendienteHoy: number;
  /** Aplicado después del corte (se devuelve al saldo). */
  devolver: number;
}

/** Partida compacta para el viaje servidor → navegador (Vercel limita la respuesta a 4,5 MB). */
export type PartidaTupla = [
  tid: string,
  lid: string,
  tipo: string,
  numero: string,
  fecha: string,
  vence: string | null,
  entidad: string | null,
  cuenta: string,
  monto: number,
  pendienteHoy: number,
  devolver: number,
];

export const aTupla = (p: Partida): PartidaTupla => [
  p.tid, p.lid, p.tipo, p.numero, p.fecha, p.vence, p.entidad, p.cuenta, p.monto, p.pendienteHoy, p.devolver,
];

export const deTupla = (t: PartidaTupla): Partida => ({
  tid: t[0], lid: t[1], tipo: t[2], numero: t[3], fecha: t[4], vence: t[5], entidad: t[6], cuenta: t[7],
  monto: t[8], pendienteHoy: t[9], devolver: t[10],
});

export interface Tercero {
  id: string;
  nombre: string;
  documento: string;
}

export interface LineaNegativa {
  tercero: Tercero;
  tipo: string;
  numero: string;
  fecha: string;
  vence: string | null;
  diasVencido: number | null;
  cuenta: string;
  saldo: number;
}

export interface TerceroNegativo {
  tercero: Tercero;
  saldo: number;
  lineas: LineaNegativa[];
  /** Facturas de venta abiertas del tercero: suman al saldo pero no se listan. */
  facturas: number;
  facturasSaldo: number;
}

export interface ResumenCartera {
  partidas: number;
  terceros: number;
  carteraTotal: number;
  porTipo: { tipo: string; partidas: number; saldo: number }[];
}

export const TIPO_LABEL: Record<string, string> = {
  CustInvc: "Factura de venta",
  CustCred: "Nota de crédito",
  CustPymt: "Pago",
  CustDep: "Depósito de cliente",
  DepAppl: "Aplicación de depósito",
  CustRfnd: "Reembolso",
  Journal: "Diario",
  FxReval: "Revaluación de moneda",
  CashSale: "Venta de contado",
  Custom: "Personalizada",
};

export const tipoLabel = (t: string) => TIPO_LABEL[t] ?? t;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function finDeMes(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Último día del mes `YYYY-MM`. */
export function corteDeMes(periodo: string): string {
  const [y, m] = periodo.split("-").map(Number);
  return finDeMes(y!, m!);
}

export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + dias)).toISOString().slice(0, 10);
}

/** Meses recientes que van cada uno en su tramo: concentran casi todas las partidas abiertas. */
const MESES_RECIENTES = 3;

/**
 * Tramos de fecha de las partidas abiertas, hasta el corte, del más reciente al más viejo
 * (así los pesados arrancan primero). Los últimos meses traen miles de facturas abiertas y
 * cada página de 1.000 filas cuesta una ejecución: van mes a mes. Lo anterior trae pocas
 * filas y en NetSuite su costo depende del rango de fechas (~1 min por año): va por año.
 */
export function tramosPartidas(corte: string): Tramo[] {
  const tramos: Tramo[] = [];
  let y = Number(corte.slice(0, 4));
  let m = Number(corte.slice(5, 7));
  const primero = (anio: number) => anio <= PRIMER_ANIO;
  for (let i = 0; i < MESES_RECIENTES && !primero(y); i++) {
    const desde = `${y}-${String(m).padStart(2, "0")}-01`;
    tramos.push({ desde, hasta: i === 0 ? corte : finDeMes(y, m), etiqueta: `${MESES[m - 1]} ${y}` });
    if (--m === 0) {
      m = 12;
      y--;
    }
  }
  // Resto del año de los recientes (enero hasta el mes anterior). Si quedó en diciembre,
  // los recientes empezaron en enero y el año anterior va completo en el ciclo de abajo.
  if (!primero(y) && tramos.length > 0 && m < 12) {
    tramos.push({
      desde: `${y}-01-01`,
      hasta: finDeMes(y, m),
      etiqueta: m === 1 ? `ene ${y}` : `ene–${MESES[m - 1]} ${y}`,
    });
    y--;
  }
  for (let a = y; a >= PRIMER_ANIO; a--) {
    const hasta = tramos.length === 0 && a === Number(corte.slice(0, 4)) ? corte : `${a}-12-31`;
    tramos.push({ desde: primero(a) ? null : `${a}-01-01`, hasta, etiqueta: String(a) });
  }
  return tramos;
}

/**
 * Tramos mensuales de las aplicaciones posteriores al corte (de corte+1 a hoy). Por mes
 * para no pasar el tope de 100.000 filas por consulta cuando el corte es antiguo.
 */
export function tramosAplicaciones(corte: string, hoy: string): Tramo[] {
  const tramos: Tramo[] = [];
  let desde = sumarDias(corte, 1);
  while (desde <= hoy) {
    const [y, m] = desde.split("-").map(Number);
    const fin = finDeMes(y!, m!);
    const hasta = fin < hoy ? fin : hoy;
    tramos.push({ desde, hasta, etiqueta: `${MESES[m! - 1]} ${y}` });
    desde = sumarDias(fin, 1);
  }
  return tramos;
}

export const clavePartida = (p: Pick<Partida, "tid" | "lid">) => `${p.tid}:${p.lid}`;

/**
 * Une partidas abiertas y partidas con aplicaciones posteriores (la misma partida puede
 * llegar de varios tramos: se suma lo que hay que devolver).
 */
export function unirPartidas(abiertas: Partida[], conAplicaciones: Partida[]): Map<string, Partida> {
  const mapa = new Map<string, Partida>();
  for (const p of abiertas) mapa.set(clavePartida(p), { ...p, devolver: 0 });
  for (const p of conAplicaciones) {
    const k = clavePartida(p);
    const actual = mapa.get(k);
    if (actual) actual.devolver += p.devolver;
    else mapa.set(k, { ...p });
  }
  return mapa;
}

/** Saldo de la partida al corte, con signo (débito +, crédito −). */
export function saldoAlCorte(p: Partida): number {
  const abierto = p.pendienteHoy + p.devolver;
  return Math.round((p.monto >= 0 ? abierto : -abierto) * 100) / 100;
}

export interface Calculo {
  resumen: ResumenCartera;
  /** Ids de los terceros con saldo negativo (para pedir sus nombres). */
  idsNegativos: string[];
  saldosPorTercero: Map<string, number>;
  partidasPorTercero: Map<string, Partida[]>;
}

export function calcular(partidas: Iterable<Partida>, corte: string): Calculo {
  const saldos = new Map<string, number>();
  const porTercero = new Map<string, Partida[]>();
  const porTipo = new Map<string, { partidas: number; saldo: number }>();
  let n = 0;
  let total = 0;
  for (const p of partidas) {
    if (p.fecha > corte) continue;
    const s = saldoAlCorte(p);
    if (Math.abs(s) < 0.005) continue;
    n++;
    total += s;
    const t = porTipo.get(p.tipo) ?? { partidas: 0, saldo: 0 };
    t.partidas++;
    t.saldo += s;
    porTipo.set(p.tipo, t);
    if (!p.entidad) continue;
    saldos.set(p.entidad, (saldos.get(p.entidad) ?? 0) + s);
    const lista = porTercero.get(p.entidad);
    if (lista) lista.push(p);
    else porTercero.set(p.entidad, [p]);
  }
  const idsNegativos = [...saldos].filter(([, s]) => s < -0.005).map(([id]) => id);
  return {
    resumen: {
      partidas: n,
      terceros: saldos.size,
      carteraTotal: Math.round(total * 100) / 100,
      porTipo: [...porTipo]
        .map(([tipo, v]) => ({ tipo, partidas: v.partidas, saldo: Math.round(v.saldo * 100) / 100 }))
        .sort((a, b) => b.partidas - a.partidas),
    },
    idsNegativos,
    saldosPorTercero: saldos,
    partidasPorTercero: porTercero,
  };
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/** Terceros negativos con sus documentos (sin facturas de venta), ordenados por nombre. */
export function negativos(calc: Calculo, terceros: Map<string, Tercero>, corte: string): TerceroNegativo[] {
  const out: TerceroNegativo[] = [];
  for (const id of calc.idsNegativos) {
    const tercero = terceros.get(id) ?? { id, nombre: `Cliente ${id}`, documento: "" };
    const partidas = calc.partidasPorTercero.get(id) ?? [];
    let facturas = 0;
    let facturasSaldo = 0;
    const lineas: LineaNegativa[] = [];
    for (const p of partidas) {
      const saldo = saldoAlCorte(p);
      if (p.tipo === "CustInvc") {
        facturas++;
        facturasSaldo += saldo;
        continue;
      }
      lineas.push({
        tercero,
        tipo: tipoLabel(p.tipo),
        numero: p.numero,
        fecha: p.fecha,
        // Notas crédito, pagos y diarios no tienen vencimiento: el informe de NetSuite usa la fecha.
        vence: p.vence ?? p.fecha,
        diasVencido: diasEntre(p.vence ?? p.fecha, corte),
        cuenta: p.cuenta,
        saldo,
      });
    }
    lineas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero.localeCompare(b.numero));
    out.push({
      tercero,
      saldo: Math.round((calc.saldosPorTercero.get(id) ?? 0) * 100) / 100,
      lineas,
      facturas,
      facturasSaldo: Math.round(facturasSaldo * 100) / 100,
    });
  }
  return out.sort((a, b) => a.tercero.nombre.localeCompare(b.tercero.nombre, "es"));
}

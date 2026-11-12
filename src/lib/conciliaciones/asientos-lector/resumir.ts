/**
 * Resume en el navegador un archivo de asientos (.xlsx o .csv, cualquier tamaño) por
 * cuenta + tipo de documento. n8n recibe solo ese resumen (unos miles de filas) y hace
 * el cruce con el balance; así un Excel de 160 MB / 2 millones de líneas no viaja entero.
 *
 * Mismas reglas que el nodo "Leer asientos" del flujo de n8n: encabezado en las primeras
 * 15 filas de cada hoja, cuenta por número o por el prefijo numérico de "Cuenta contable",
 * débito/crédito en moneda base si existe la columna (DEBITO COP), y se omiten las
 * líneas con fecha fuera del periodo o de otra subsidiaria.
 */

import { leerDirectorioZip, porBloques, streamEntrada } from "./zip";

export interface FilaResumen {
  cuenta: string;
  nombre: string;
  tipo: string;
  lineas: number;
  debito: number;
  credito: number;
}

export interface LecturaAsientos {
  hojas: string[];
  filas: number;
  usadas: number;
  fueraPeriodo: number;
  otraSubsidiaria: number;
  sinCuenta: number;
  /** Columnas usadas, para mostrarlas en el Excel resultante. */
  columnas: string;
}

export interface ResumenArchivo {
  filas: FilaResumen[];
  lectura: LecturaAsientos;
}

export interface OpcionesResumen {
  desde: string; // YYYY-MM-DD
  hasta: string;
  subsidiaria?: string;
  onProgreso?: (fraccion: number, etapa: string) => void;
}

type Celda = string | number | null;

export const normH = (s: unknown): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** 1.234.567,89 · 1,234,567.89 · (123) · $ */
export function aNumero(v: Celda): number {
  if (v === null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = v.trim().replace(/[$\s]/g, "");
  if (!s) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  const coma = s.lastIndexOf(",");
  const punto = s.lastIndexOf(".");
  if (coma > -1 && punto > -1) s = coma > punto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (coma > -1) s = /,\d{1,2}$/.test(s) && (s.match(/,/g) ?? []).length === 1 ? s.replace(",", ".") : s.replace(/,/g, "");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

function fechaISO(x: Celda): string {
  if (x === null || x === "") return "";
  const n = typeof x === "number" ? x : /^\d+(\.\d+)?$/.test(x.trim()) ? Number(x) : NaN;
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    return new Date(Math.round((n - 25569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const t = String(x).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return "";
}

const COLUMNAS = {
  num: ["numerocuenta", "nocuenta", "numcuenta", "acctnumber", "accountnumber", "codigocuenta", "cuenta", "account"],
  nom: ["cuentacontable", "nombrecuenta", "cuentanombre", "accountname", "nombredelacuenta"],
  deb: ["debitocop", "debitomonedabase", "debito", "debit", "debitos", "debe"],
  cre: ["creditocop", "creditomonedabase", "credito", "credit", "creditos", "haber"],
  mon: ["monto", "amount", "importe", "valor"],
  tipo: ["codigotipo", "type", "tipo", "tipodocumento", "tipodedocumento", "tipotransaccion"],
  fecha: ["fecha", "fechadocumento", "fechacontable", "trandate", "date"],
  sub: ["subsidiaria", "subsidiary"],
} as const;

type Columnas = Record<keyof typeof COLUMNAS, number>;

const pick = (n: string[], opciones: readonly string[]) => {
  for (const o of opciones) {
    const i = n.indexOf(o);
    if (i > -1) return i;
  }
  return -1;
};

/** Agregador común a xlsx y csv: decide encabezados por hoja y suma por cuenta + tipo. */
function crearAgregador(op: OpcionesResumen) {
  const cols = new Map<string, Columnas>();
  const intentos = new Map<string, number>();
  const agg = new Map<string, FilaResumen>();
  const lectura: LecturaAsientos = { hojas: [], filas: 0, usadas: 0, fueraPeriodo: 0, otraSubsidiaria: 0, sinCuenta: 0, columnas: "" };
  const subFiltro = normH(op.subsidiaria);
  let primeraFila = "";

  function fila(hoja: string, celdas: Celda[]) {
    let C = cols.get(hoja);
    if (!C) {
      const k = (intentos.get(hoja) ?? 0) + 1;
      intentos.set(hoja, k);
      if (k > 15) return;
      const n = Array.from(celdas, normH);
      const c = Object.fromEntries(
        Object.entries(COLUMNAS).map(([key, lista]) => [key, pick(n, lista)]),
      ) as Columnas;
      if ((c.num < 0 && c.nom < 0) || ((c.deb < 0 || c.cre < 0) && c.mon < 0)) {
        if (!primeraFila) primeraFila = Array.from(celdas).filter((x) => x !== null && x !== "").slice(0, 16).join(" | ");
        return;
      }
      cols.set(hoja, c);
      lectura.hojas.push(hoja);
      if (!lectura.columnas) {
        const nombre = (i: number) => (i > -1 ? String(celdas[i] ?? "").trim() : "");
        lectura.columnas = [c.num > -1 ? nombre(c.num) : nombre(c.nom), nombre(c.deb > -1 ? c.deb : c.mon), nombre(c.cre), nombre(c.tipo), nombre(c.fecha)]
          .filter(Boolean)
          .join(", ");
      }
      return;
    }
    lectura.filas++;
    let cuenta: Celda = C.num > -1 ? (celdas[C.num] ?? null) : null;
    const nombre = C.nom > -1 ? String(celdas[C.nom] ?? "").trim() : "";
    if (cuenta === null || cuenta === "") {
      const m = /^\s*(\d{3,})/.exec(nombre);
      cuenta = m ? m[1]! : nombre;
    }
    if (cuenta === null || cuenta === "") {
      lectura.sinCuenta++;
      return;
    }
    const cuentaTxt = typeof cuenta === "number" ? String(Math.round(cuenta)) : cuenta.trim();
    if (normH(cuentaTxt) === "numerocuenta" || normH(cuentaTxt) === "cuentacontable") return; // encabezado repetido
    if (subFiltro && C.sub > -1) {
      const s = celdas[C.sub];
      if (s !== null && s !== undefined && s !== "" && normH(s) !== subFiltro) {
        lectura.otraSubsidiaria++;
        return;
      }
    }
    if (C.fecha > -1) {
      const f = fechaISO(celdas[C.fecha] ?? null);
      if (f && (f < op.desde || f > op.hasta)) {
        lectura.fueraPeriodo++;
        return;
      }
    }
    let d = C.deb > -1 ? aNumero(celdas[C.deb] ?? null) : 0;
    let c = C.cre > -1 ? aNumero(celdas[C.cre] ?? null) : 0;
    if (C.deb < 0 || C.cre < 0) {
      const mto = aNumero(celdas[C.mon] ?? null);
      d = mto > 0 ? mto : 0;
      c = mto < 0 ? -mto : 0;
    }
    let tipo = C.tipo > -1 ? String(celdas[C.tipo] ?? "").trim() : "";
    // El motor de n8n reconoce las transferencias por su código interno.
    if (/^transferencia/i.test(tipo)) tipo = "Transfer";
    const key = `${cuentaTxt}|${tipo}`;
    let a = agg.get(key);
    if (!a) {
      a = { cuenta: cuentaTxt, nombre, tipo, lineas: 0, debito: 0, credito: 0 };
      agg.set(key, a);
    }
    a.lineas++;
    a.debito += d;
    a.credito += c;
    lectura.usadas++;
  }

  function terminar(): ResumenArchivo {
    if (!lectura.hojas.length) {
      throw new Error(
        "No se encontraron columnas de cuenta y débito/crédito en el archivo de asientos." +
          (primeraFila ? ` Primera fila: ${primeraFila}` : ""),
      );
    }
    if (!lectura.usadas) throw new Error("El archivo de asientos no tiene líneas del periodo para conciliar.");
    return { filas: [...agg.values()], lectura };
  }

  return { fila, terminar };
}

// ---------- XLSX ----------

const ENTIDADES: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
function decodeXml(s: string): string {
  return s.indexOf("&") < 0
    ? s
    : s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|quot|apos|amp);/g, (_, e: string) =>
        e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTIDADES[e]!,
      );
}
const RE_T = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
function textoDe(xml: string): string {
  if (xml.indexOf("<r>") < 0 && xml.indexOf("<r ") < 0) {
    const m = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(xml);
    return m ? decodeXml(m[1]!) : "";
  }
  let t = "";
  RE_T.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_T.exec(xml))) t += m[1];
  return decodeXml(t);
}

function colIdx(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

async function textoEntrada(blob: Blob, entrada: Parameters<typeof streamEntrada>[1]): Promise<string> {
  const reader = (await streamEntrada(blob, entrada)).getReader();
  let t = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return t;
    t += value;
  }
}

async function resumirXlsx(blob: Blob, op: OpcionesResumen, agregador: ReturnType<typeof crearAgregador>) {
  const zip = await leerDirectorioZip(blob);
  const wb = zip.get("xl/workbook.xml");
  if (!wb) throw new Error("El .xlsx no tiene libro (xl/workbook.xml).");
  const rels = zip.get("xl/_rels/workbook.xml.rels");
  const relXml = rels ? await textoEntrada(blob, rels) : "";
  const destino = new Map<string, string>();
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const tg = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && tg) destino.set(id, "xl/" + tg.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const hojas: { nombre: string; path: string }[] = [];
  for (const m of (await textoEntrada(blob, wb)).matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = decodeXml(/\bname="([^"]*)"/.exec(m[0])?.[1] ?? "");
    const path = destino.get(/\br:id="([^"]+)"/.exec(m[0])?.[1] ?? "");
    if (path && zip.has(path)) hojas.push({ nombre, path });
  }

  // Progreso por bytes comprimidos: textos compartidos + hojas.
  const sstEntrada = zip.get("xl/sharedStrings.xml");
  const total = (sstEntrada?.comprimido ?? 0) + hojas.reduce((s, h) => s + zip.get(h.path)!.comprimido, 0);
  let leidos = 0;
  const avanzar = (etapa: string) => (n: number) => {
    leidos += n;
    op.onProgreso?.(total ? leidos / total : 0, etapa);
  };

  // Los textos compartidos van al final del ZIP pero se necesitan antes que las hojas.
  const sst: string[] = [];
  if (sstEntrada) {
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    await porBloques(await streamEntrada(blob, sstEntrada, avanzar("Leyendo textos")), "</si>", (bloque) => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(bloque))) sst.push(textoDe(m[1]!));
    });
  }

  const reFila = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  const reCelda = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  for (const h of hojas) {
    const etapa = `Leyendo ${h.nombre}`;
    await porBloques(await streamEntrada(blob, zip.get(h.path)!, avanzar(etapa)), "</row>", (bloque) => {
      reFila.lastIndex = 0;
      let f: RegExpExecArray | null;
      while ((f = reFila.exec(bloque))) {
        const celdas: Celda[] = [];
        const cuerpo = f[1];
        if (cuerpo) {
          reCelda.lastIndex = 0;
          let c: RegExpExecArray | null;
          let auto = 0;
          while ((c = reCelda.exec(cuerpo))) {
            const at = c[1]!;
            const r = /\br="([A-Z]+)/.exec(at);
            const idx = r ? colIdx(r[1]!) : auto;
            auto = idx + 1;
            const inner = c[2];
            if (!inner) continue;
            const t = /\bt="([^"]+)"/.exec(at)?.[1];
            if (t === "inlineStr") {
              celdas[idx] = textoDe(inner);
              continue;
            }
            const i = inner.indexOf("<v>");
            if (i < 0) continue;
            const v = inner.slice(i + 3, inner.indexOf("</v>", i));
            if (t === "s") celdas[idx] = sst[Number(v)] ?? "";
            else if (t === "str" || t === "e") celdas[idx] = decodeXml(v);
            else if (t === "b") celdas[idx] = v === "1" ? "Sí" : "No";
            else {
              const n = Number(v);
              celdas[idx] = Number.isFinite(n) ? n : decodeXml(v);
            }
          }
        }
        agregador.fila(h.nombre, celdas);
      }
    });
  }
}

// ---------- CSV ----------

async function resumirCsv(blob: Blob, op: OpcionesResumen, agregador: ReturnType<typeof crearAgregador>) {
  // UTF-8 salvo que la muestra no lo sea (exportaciones de Excel en Windows: latin1).
  const muestra = new Uint8Array(await blob.slice(0, 64 * 1024).arrayBuffer());
  let utf8 = true;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(muestra.subarray(0, muestra.length - 4));
  } catch {
    utf8 = false;
  }
  const primeraLinea = new TextDecoder(utf8 ? "utf-8" : "latin1").decode(muestra).split(/\r?\n/)[0] ?? "";
  const sep = [";", ",", "\t", "|"].sort((a, b) => primeraLinea.split(b).length - primeraLinea.split(a).length)[0]!;

  let leidos = 0;
  const contador = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      leidos += chunk.byteLength;
      op.onProgreso?.(blob.size ? leidos / blob.size : 0, "Leyendo CSV");
      ctrl.enqueue(chunk);
    },
  });
  const reader = blob
    .stream()
    .pipeThrough(contador)
    .pipeThrough(new TextDecoderStream(utf8 ? "utf-8" : "latin1") as unknown as TransformStream<Uint8Array, string>)
    .getReader();

  let campo = "";
  let fila: Celda[] = [];
  let comillas = false;
  let primero = true;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    let txt = value;
    if (primero) {
      txt = txt.replace(/^﻿/, "");
      primero = false;
    }
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i]!;
      if (comillas) {
        if (ch === '"') {
          if (txt[i + 1] === '"') {
            campo += '"';
            i++;
          } else comillas = false;
        } else campo += ch;
      } else if (ch === '"') comillas = true;
      else if (ch === sep) {
        fila.push(campo);
        campo = "";
      } else if (ch === "\n") {
        fila.push(campo.replace(/\r$/, ""));
        campo = "";
        agregador.fila("CSV", fila);
        fila = [];
      } else campo += ch;
    }
  }
  if (campo !== "" || fila.length) {
    fila.push(campo);
    agregador.fila("CSV", fila);
  }
}

export async function resumirArchivoAsientos(archivo: Blob, nombre: string, op: OpcionesResumen): Promise<ResumenArchivo> {
  const agregador = crearAgregador(op);
  const firma = new Uint8Array(await archivo.slice(0, 4).arrayBuffer());
  if (firma[0] === 0x50 && firma[1] === 0x4b) await resumirXlsx(archivo, op, agregador);
  else if (/\.xls$/i.test(nombre) || (firma[0] === 0xd0 && firma[1] === 0xcf))
    throw new Error("El formato .xls (Excel 97-2003) no se puede leer. Guárdalo como .xlsx o .csv.");
  else await resumirCsv(archivo, op, agregador);
  op.onProgreso?.(1, "Listo");
  return agregador.terminar();
}

/** CSV con el resumen (lo que se sube y lee el nodo "Leer asientos" de n8n). */
export function resumenACsv(filas: FilaResumen[]): string {
  const q = (s: string) => (/[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lineas = ["Número Cuenta;Cuenta Contable;Código Tipo;Líneas;Débito;Crédito"];
  for (const f of filas) {
    lineas.push([q(f.cuenta), q(f.nombre), q(f.tipo), f.lineas, f.debito.toFixed(2), f.credito.toFixed(2)].join(";"));
  }
  return lineas.join("\n");
}

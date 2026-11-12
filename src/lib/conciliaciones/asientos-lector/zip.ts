/**
 * Lectura de un .zip (un .xlsx) desde un `Blob` con acceso aleatorio: se lee el
 * directorio central del final del archivo y cada entrada se descomprime en
 * streaming con `DecompressionStream("deflate-raw")`, nativo del navegador.
 * Nunca se carga el archivo completo en memoria. Soporta Zip64.
 */

export interface EntradaZip {
  nombre: string;
  metodo: number;
  comprimido: number;
  descomprimido: number;
  offsetLocal: number;
}

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX_32 = 0xffffffff;

async function bytes(blob: Blob, desde: number, hasta: number): Promise<DataView> {
  return new DataView(await blob.slice(desde, hasta).arrayBuffer());
}

function u64(v: DataView, o: number): number {
  return v.getUint32(o, true) + v.getUint32(o + 4, true) * 2 ** 32;
}

export async function leerDirectorioZip(blob: Blob): Promise<Map<string, EntradaZip>> {
  const cola = Math.min(blob.size, 22 + 65_535 + 20);
  const fin = await bytes(blob, blob.size - cola, blob.size);
  let eocd = -1;
  for (let i = fin.byteLength - 22; i >= 0; i--) {
    if (fin.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El archivo no es un .xlsx válido o está incompleto (no tiene índice ZIP).");

  let total = fin.getUint16(eocd + 10, true);
  let tamCentral = fin.getUint32(eocd + 12, true);
  let offCentral = fin.getUint32(eocd + 16, true);
  if (total === 0xffff || tamCentral === MAX_32 || offCentral === MAX_32) {
    const loc = eocd - 20;
    if (loc < 0 || fin.getUint32(loc, true) !== SIG_ZIP64_LOCATOR) throw new Error("ZIP64 sin localizador.");
    const offZ64 = u64(fin, loc + 8);
    const z64 = await bytes(blob, offZ64, offZ64 + 56);
    if (z64.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new Error("ZIP64 dañado.");
    total = u64(z64, 32);
    tamCentral = u64(z64, 40);
    offCentral = u64(z64, 48);
  }

  const cd = await bytes(blob, offCentral, offCentral + tamCentral);
  const dec = new TextDecoder();
  const entradas = new Map<string, EntradaZip>();
  let p = 0;
  for (let i = 0; i < total && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== SIG_CENTRAL) break;
    const metodo = cd.getUint16(p + 10, true);
    let comprimido = cd.getUint32(p + 20, true);
    let descomprimido = cd.getUint32(p + 24, true);
    const nl = cd.getUint16(p + 28, true);
    const xl = cd.getUint16(p + 30, true);
    const cl = cd.getUint16(p + 32, true);
    let offsetLocal = cd.getUint32(p + 42, true);
    const nombre = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
    // Campo extra Zip64 (0x0001): trae, en orden, los valores que valen 0xFFFFFFFF.
    let x = p + 46 + nl;
    const finExtra = x + xl;
    while (x + 4 <= finExtra) {
      const id = cd.getUint16(x, true);
      const len = cd.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (descomprimido === MAX_32) { descomprimido = u64(cd, q); q += 8; }
        if (comprimido === MAX_32) { comprimido = u64(cd, q); q += 8; }
        if (offsetLocal === MAX_32) { offsetLocal = u64(cd, q); }
      }
      x += 4 + len;
    }
    entradas.set(nombre, { nombre, metodo, comprimido, descomprimido, offsetLocal });
    p += 46 + nl + xl + cl;
  }
  return entradas;
}

/** Texto de una entrada, en streaming. `onBytes` recibe los bytes comprimidos leídos. */
export async function streamEntrada(
  blob: Blob,
  e: EntradaZip,
  onBytes?: (n: number) => void,
): Promise<ReadableStream<string>> {
  const local = await bytes(blob, e.offsetLocal, e.offsetLocal + 30);
  if (local.getUint32(0, true) !== SIG_LOCAL) throw new Error(`Entrada ZIP dañada: ${e.nombre}`);
  const inicio = e.offsetLocal + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  let datos: ReadableStream<Uint8Array> = blob.slice(inicio, inicio + e.comprimido).stream();
  if (onBytes) {
    datos = datos.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctrl) {
          onBytes(chunk.byteLength);
          ctrl.enqueue(chunk);
        },
      }),
    );
  }
  if (e.metodo === 8) {
    datos = datos.pipeThrough(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>);
  } else if (e.metodo !== 0) {
    throw new Error(`Compresión ZIP no soportada (${e.metodo}) en ${e.nombre}.`);
  }
  return datos.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>);
}

/** Recorre un stream de texto entregando trozos completos delimitados por `cierre`. */
export async function porBloques(
  stream: ReadableStream<string>,
  cierre: string,
  alBloque: (texto: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  let resto = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const texto = resto + value;
    const corte = texto.lastIndexOf(cierre);
    if (corte < 0) {
      resto = texto;
      if (resto.length > 64 * 1024 * 1024) throw new Error("El archivo tiene una fila demasiado larga.");
      continue;
    }
    alBloque(texto.slice(0, corte + cierre.length));
    resto = texto.slice(corte + cierre.length);
  }
  if (resto) alBloque(resto);
}

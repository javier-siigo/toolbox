/// <reference lib="webworker" />
/**
 * Resume el archivo de asientos fuera del hilo principal: un Excel de 160 MB tarda
 * ~30 s y la página sigue respondiendo (progreso, cancelar).
 */
import { resumenACsv, resumirArchivoAsientos, type LecturaAsientos } from "./resumir";

export interface MensajeResumir {
  archivo: File;
  desde: string;
  hasta: string;
  subsidiaria?: string;
}

export type RespuestaResumir =
  | { tipo: "progreso"; fraccion: number; etapa: string }
  | { tipo: "listo"; csv: string; lectura: LecturaAsientos; grupos: number }
  | { tipo: "error"; mensaje: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (e: MessageEvent<MensajeResumir>) => {
  const { archivo, desde, hasta, subsidiaria } = e.data;
  let ultimo = -1;
  try {
    const r = await resumirArchivoAsientos(archivo, archivo.name, {
      desde,
      hasta,
      subsidiaria,
      onProgreso: (fraccion, etapa) => {
        const p = Math.floor(fraccion * 100);
        if (p === ultimo) return;
        ultimo = p;
        ctx.postMessage({ tipo: "progreso", fraccion, etapa } satisfies RespuestaResumir);
      },
    });
    ctx.postMessage({ tipo: "listo", csv: resumenACsv(r.filas), lectura: r.lectura, grupos: r.filas.length } satisfies RespuestaResumir);
  } catch (err) {
    ctx.postMessage({ tipo: "error", mensaje: (err as Error).message || "No se pudo leer el archivo de asientos." } satisfies RespuestaResumir);
  }
};

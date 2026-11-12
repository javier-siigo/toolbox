"use client";

import type { LecturaAsientos } from "./resumir";
import type { MensajeResumir, RespuestaResumir } from "./resumir.worker";

export interface ResumenCliente {
  csv: Blob;
  lectura: LecturaAsientos;
  grupos: number;
}

export function lectorDisponible(): boolean {
  return typeof Worker !== "undefined" && typeof DecompressionStream !== "undefined" && typeof TextDecoderStream !== "undefined";
}

/** Resume el archivo en un Web Worker. Se cancela con `signal` (termina el worker). */
export function resumirEnNavegador(
  archivo: File,
  periodo: { desde: string; hasta: string },
  subsidiaria: string | undefined,
  onProgreso: (fraccion: number, etapa: string) => void,
  signal: AbortSignal,
): Promise<ResumenCliente> {
  return new Promise((resolve, reject) => {
    if (!lectorDisponible()) {
      reject(new Error("Este navegador no puede leer el archivo en el equipo. Usa Chrome, Edge o Firefox actualizados."));
      return;
    }
    const worker = new Worker(new URL("./resumir.worker.ts", import.meta.url), { type: "module" });
    const terminar = () => worker.terminate();
    signal.addEventListener(
      "abort",
      () => {
        terminar();
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
    worker.onmessage = (e: MessageEvent<RespuestaResumir>) => {
      const m = e.data;
      if (m.tipo === "progreso") onProgreso(m.fraccion, m.etapa);
      else if (m.tipo === "listo") {
        terminar();
        resolve({ csv: new Blob([m.csv], { type: "text/csv" }), lectura: m.lectura, grupos: m.grupos });
      } else {
        terminar();
        reject(new Error(m.mensaje));
      }
    };
    worker.onerror = (e) => {
      terminar();
      reject(new Error(e.message || "Falló la lectura del archivo en el navegador."));
    };
    worker.postMessage({ archivo, desde: periodo.desde, hasta: periodo.hasta, subsidiaria } satisfies MensajeResumir);
  });
}

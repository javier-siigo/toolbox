export type Pais = "CO" | "MX" | "UY" | "CL" | "EC";

export interface BancoConciliacion {
  slug: string;
  nombre: string;
  descripcion: string | null;
  esParticular: boolean;
  periodo: string | null;
  periodoCierre: string | null;
}

export type ConciliacionRunStatus =
  | "idle"
  | "uploading"
  | "processing"
  | "done"
  | "error";

export interface ConciliacionRun {
  id: string;
  status: ConciliacionRunStatus;
  banco: string;
  bancoNombre: string;
  principalFilename: string;
  principalSize: number;
  previoFilename?: string;
  previoSize?: number;
  startedAt: number;
  finishedAt?: number;
  resultFilename?: string;
  resultSize?: number;
  resultBlob?: Blob;
  resultContentType?: string;
  registrosNuevos?: number;
  registrosExistentes?: number;
  registrosFueraPeriodo?: number;
  error?: string;
}

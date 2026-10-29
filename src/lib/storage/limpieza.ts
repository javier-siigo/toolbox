import "server-only";

import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

// Todo lo que vive en estos buckets es temporal:
//   - uploads: n8n los procesa en la misma petición (máx. 300 s) y la ruta los borra
//     al terminar, pero ese borrado es best-effort y deja huérfanos si algo falla.
//   - exports: el Excel se entrega por URL firmada de 1 h; después nadie puede bajarlo.
// Un día de margen cubre cualquier proceso en curso.
const RETENCION_MS = 24 * 60 * 60 * 1000;
const LOTE = 100;

export interface ResultadoLimpieza {
  bucket: string;
  borrados: number;
  error?: string;
}

function bucketsTemporales(): string[] {
  return ["conciliaciones-uploads", "notas-credito-uploads", serverEnv().EXPORTS_BUCKET];
}

export async function limpiarStorage(ahora = new Date()): Promise<ResultadoLimpieza[]> {
  const admin = createAdminClient();
  const buckets = bucketsTemporales();
  const antes = new Date(ahora.getTime() - RETENCION_MS).toISOString();

  const { data, error } = await admin
    .schema("core")
    .rpc("storage_archivos_vencidos", { p_buckets: buckets, p_antes: antes });
  if (error) throw new Error(`No se pudieron listar los archivos vencidos: ${error.message}`);

  const porBucket = new Map<string, string[]>(buckets.map((b) => [b, []]));
  for (const { bucket_id, name } of data ?? []) porBucket.get(bucket_id)?.push(name);

  const resultados: ResultadoLimpieza[] = [];
  for (const [bucket, nombres] of porBucket) {
    let borrados = 0;
    let fallo: string | undefined;
    for (let i = 0; i < nombres.length; i += LOTE) {
      const { data: removidos, error: rmErr } = await admin.storage
        .from(bucket)
        .remove(nombres.slice(i, i + LOTE));
      if (rmErr) {
        fallo = rmErr.message;
        break;
      }
      borrados += removidos?.length ?? 0;
    }
    resultados.push({ bucket, borrados, ...(fallo ? { error: fallo } : {}) });
  }
  return resultados;
}

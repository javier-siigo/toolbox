import "server-only";

import { requireSesion } from "@/lib/auth/acceso";
import { puedeAlguno, type Permisos } from "@/lib/auth/permisos-shared";

import { DOCUMENTOS, type DocumentoMeta } from "./registry";

export interface ContextoDocumentacion {
  permisos: Permisos;
  esAdmin: boolean;
  /** Documentos que el usuario puede leer, en el orden del registro. */
  accesibles: DocumentoMeta[];
}

/** Sesión y documentos visibles. Los permisos se validan aquí, en el servidor. */
export async function contextoDocumentacion(): Promise<ContextoDocumentacion> {
  const { permisos } = await requireSesion();
  return {
    permisos,
    esAdmin: permisos.esAdmin,
    accesibles: DOCUMENTOS.filter((d) => puedeDocumento(permisos, d)),
  };
}

export function puedeDocumento(permisos: Permisos, doc: DocumentoMeta): boolean {
  return permisos.esAdmin || puedeAlguno(permisos, doc.requiere);
}

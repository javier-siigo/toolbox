import { CONCILIACION_POR_PAIS, PROCESOS, type ProcesoId } from "@/lib/auth/permisos-shared";

/**
 * Documentos de `docs/procesos/` que se publican en /documentacion.
 * Sin dependencias de servidor: lo usan el menú (cliente) y las páginas.
 */
export interface DocumentoMeta {
  slug: string;
  /** Archivo dentro de `docs/procesos/`. */
  archivo: string;
  /** Nombre corto para el menú y la navegación Anterior/Siguiente. */
  titulo: string;
  descripcion: string;
  /** Basta con acceso (cualquier nivel) a uno de estos procesos. Vacío: cualquier usuario autenticado. */
  requiere: readonly ProcesoId[];
}

export const DOCUMENTOS: readonly DocumentoMeta[] = [
  {
    slug: "arquitectura-general",
    archivo: "00-arquitectura-general.md",
    titulo: "Arquitectura general",
    descripcion: "Stack, estructura del repositorio, mapa de procesos y patrones comunes del portal.",
    requiere: [],
  },
  {
    slug: "autenticacion-y-roles",
    archivo: "01-autenticacion-y-roles.md",
    titulo: "Autenticación y permisos",
    descripcion: "Inicio de sesión, protección de rutas, permisos por proceso y administración de usuarios.",
    requiere: [],
  },
  {
    slug: "conciliaciones",
    archivo: "02-conciliaciones.md",
    titulo: "Conciliaciones bancarias",
    descripcion: "Conciliación por país y banco: flujo, contrato con n8n, datos y errores.",
    requiere: Object.values(CONCILIACION_POR_PAIS),
  },
  {
    slug: "notas-credito",
    archivo: "03-notas-credito.md",
    titulo: "Notas crédito",
    descripcion: "Conciliación de notas crédito contra NetSuite y resaltado de diferencias.",
    requiere: [PROCESOS.NOTAS_CREDITO],
  },
  {
    slug: "calculo-comisiones",
    archivo: "04-calculo-comisiones.md",
    titulo: "Cálculo de comisiones",
    descripcion: "Reconocimiento del gasto por cohortes, asientos, controles y cierres.",
    requiere: [PROCESOS.CALCULO_COMISIONES],
  },
  {
    slug: "gestion-anticipos",
    archivo: "05-gestion-anticipos.md",
    titulo: "Gestión de anticipos",
    descripcion: "Registro y legalización de anticipos y cruce con excolaboradores.",
    requiere: [PROCESOS.GESTION_ANTICIPOS],
  },
  {
    slug: "importacion-retirados",
    archivo: "06-importacion-retirados.md",
    titulo: "Importación de excolaboradores",
    descripcion: "Carga del reporte de retirados, reglas de importación y búsqueda manual.",
    requiere: [PROCESOS.GESTION_ANTICIPOS],
  },
];

export function findDocumento(slug: string): DocumentoMeta | undefined {
  return DOCUMENTOS.find((d) => d.slug === slug);
}

export function findDocumentoPorArchivo(archivo: string): DocumentoMeta | undefined {
  return DOCUMENTOS.find((d) => d.archivo === archivo);
}

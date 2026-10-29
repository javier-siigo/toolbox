import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BookOpen,
  Calculator,
  FileChartColumn,
  FileText,
  HandCoins,
  Landmark,
  Receipt,
  Scale,
  Settings,
  Zap,
} from "lucide-react";

import { PROCESOS, type ProcesoId } from "@/lib/auth/permisos-shared";
import { DOCUMENTOS } from "@/lib/documentacion/registry";

export type Proceso = {
  slug: string;
  label: string;
  description: string;
  icon: LucideIcon;
  flagCode?: string;
  /** Proceso con permisos propios (`core.procesos`). Sin `id`, decide `requiere`. */
  id?: ProcesoId;
  /** Sin `id`: visible con acceso a alguno de estos procesos; vacío = cualquier usuario. Solo Documentación. */
  requiere?: readonly ProcesoId[];
};

export type Area = {
  slug: string;
  label: string;
  description: string;
  icon: LucideIcon;
  procesos: Proceso[];
  /** Se abre desde el menú de usuario, no desde la barra lateral. */
  enMenuUsuario?: boolean;
};

export const AREAS: Area[] = [
  {
    slug: "conciliaciones",
    label: "Conciliaciones",
    description: "Comparación y cierre contable por país.",
    icon: Scale,
    procesos: [
      {
        id: PROCESOS.CONCILIACION_CHILE,
        slug: "chile",
        label: "Chile",
        description: "Conciliación contable para operaciones en Chile.",
        icon: Scale,
        flagCode: "CL",
      },
      {
        id: PROCESOS.CONCILIACION_COLOMBIA,
        slug: "colombia",
        label: "Colombia",
        description: "Conciliación contable para operaciones en Colombia.",
        icon: Scale,
        flagCode: "CO",
      },
      {
        id: PROCESOS.CONCILIACION_ECUADOR,
        slug: "ecuador",
        label: "Ecuador",
        description: "Conciliación contable para operaciones en Ecuador.",
        icon: Scale,
        flagCode: "EC",
      },
      {
        id: PROCESOS.CONCILIACION_MEXICO,
        slug: "mexico",
        label: "México",
        description: "Conciliación contable para operaciones en México.",
        icon: Scale,
        flagCode: "MX",
      },
      {
        id: PROCESOS.CONCILIACION_URUGUAY,
        slug: "uruguay",
        label: "Uruguay",
        description: "Conciliación contable para operaciones en Uruguay.",
        icon: Scale,
        flagCode: "UY",
      },
    ],
  },
  {
    slug: "ingresos-egresos",
    label: "Ingresos y egresos",
    description: "Procesos del ciclo de ingresos y de pagos.",
    icon: ArrowLeftRight,
    procesos: [
      {
        id: PROCESOS.GESTION_ANTICIPOS,
        slug: "gestion-anticipos",
        label: "Gestión y Legalización de Anticipos",
        description:
          "Registro y seguimiento de anticipos por colaborador y requerimiento.",
        icon: HandCoins,
      },
      {
        id: PROCESOS.NOTAS_CREDITO,
        slug: "notas-credito",
        label: "Notas crédito",
        description: "Registro y gestión de notas crédito.",
        icon: Receipt,
      },
      {
        id: PROCESOS.CALCULO_COMISIONES,
        slug: "calculo-comisiones",
        label: "Cálculo de Comisiones",
        description:
          "Procesamiento y control mensual del reconocimiento de comisiones.",
        icon: Calculator,
      },
      {
        id: PROCESOS.SERVICIOS_PUBLICOS,
        slug: "servicios-publicos",
        label: "Servicios públicos",
        description:
          "Seguimiento de recibos de servicios públicos: factura, registro, pago y soporte.",
        icon: Zap,
      },
    ],
  },
  {
    slug: "reportes",
    label: "Reportes",
    description: "Extracciones y reportes contables para auditoría.",
    icon: FileChartColumn,
    procesos: [
      {
        id: PROCESOS.EXPORT_BANCOS,
        slug: "export-bancos",
        label: "Auditoría Asientos de Diario",
        description:
          "Exporta a Excel las líneas contables de NetSuite de un periodo: bancos o, por tipo de cuenta, todos los documentos.",
        icon: Landmark,
      },
    ],
  },
  {
    slug: "documentacion",
    label: "Documentación",
    description: "Cómo funciona cada proceso del portal.",
    icon: BookOpen,
    enMenuUsuario: true,
    procesos: DOCUMENTOS.map((d) => ({
      slug: d.slug,
      label: d.titulo,
      description: d.descripcion,
      icon: FileText,
      requiere: d.requiere,
    })),
  },
  {
    slug: "admin",
    label: "Administración",
    description: "Configuración interna del portal.",
    icon: Settings,
    enMenuUsuario: true,
    procesos: [
      {
        slug: "usuarios",
        label: "Usuarios y roles",
        description: "Asigna roles y permisos a los miembros del equipo.",
        icon: Settings,
      },
    ],
  },
];

export function findArea(areaSlug: string): Area | undefined {
  return AREAS.find((a) => a.slug === areaSlug);
}

export function findProceso(areaSlug: string, procesoSlug: string): Proceso | undefined {
  return findArea(areaSlug)?.procesos.find((p) => p.slug === procesoSlug);
}

export function procesoHref(areaSlug: string, procesoSlug: string): string {
  return `/${areaSlug}/${procesoSlug}`;
}

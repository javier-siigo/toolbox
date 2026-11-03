import type { TourStep } from "@/components/tour/como-usar";

/** Recorrido "¿Cómo usar?" de Gestión y Legalización de Anticipos. */
export const TOUR_ANTICIPOS: TourStep[] = [
  {
    title: "Gestión y legalización de anticipos",
    description:
      "Aquí registras cada anticipo por colaborador y requerimiento, haces seguimiento de lo que falta y lo marcas como legalizado cuando llegan los soportes.",
  },
  {
    target: "kpis",
    title: "El estado de un vistazo",
    description:
      "Cuántos anticipos hay, cuántos siguen pendientes, cuántos son devoluciones y qué porcentaje ya está legalizado. Se actualizan solos con cada cambio.",
    side: "bottom",
  },
  {
    target: "importar",
    title: "Cruza los excolaboradores",
    description:
      "Importa el reporte de retirados de Contabilidad. Los anticipos de excolaboradores quedan marcados en la tabla y aquí ves el valor que tienen pendiente. Actualízalo cuando llegue un reporte nuevo.",
    side: "bottom",
  },
  {
    target: "nuevo",
    title: "1. Registra un anticipo",
    description:
      "Abre el formulario con el colaborador, el código de requerimiento, la fecha de RQ, qué falta y la observación de seguimiento.",
    side: "bottom",
  },
  {
    target: "buscar",
    title: "2. Encuentra un registro",
    description: "Escribe parte del nombre del colaborador o del código de requerimiento.",
    side: "bottom",
  },
  {
    target: "filtros",
    title: "Filtra la tabla",
    description:
      "Filtra por lo que falta (soportes, descuento de nómina, devolución…) o por la observación de seguimiento, o deja solo los excolaboradores. En Columnas eliges qué columnas ver. Limpiar filtros vuelve a la vista completa.",
    side: "bottom",
  },
  {
    target: "exportar",
    title: "Descarga el reporte",
    description:
      "Genera un Excel con un resumen de indicadores y el detalle de los registros. Respeta la búsqueda, los filtros y el orden que tengas en la tabla.",
    side: "bottom",
  },
  {
    target: "fila",
    title: "3. Actualiza el seguimiento",
    description:
      "Con el botón ⋯ al final de cada fila editas el registro, lo legalizas cuando ya está completo o lo eliminas. Las filas en gris son de excolaboradores.",
    side: "bottom",
  },
  {
    target: "paginacion",
    title: "Recorre los registros",
    description:
      "Cuántos registros ves de cuántos hay, filas por página y el paso entre páginas.",
    side: "top",
  },
];

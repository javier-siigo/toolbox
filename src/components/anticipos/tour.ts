import type { TourStep } from "@/components/tour/como-usar";

/** Recorrido "¿Cómo usar?" de Gestión y Legalización de Anticipos. */
export const TOUR_ANTICIPOS: TourStep[] = [
  {
    title: "Gestión y legalización de anticipos",
    description:
      "Aquí registras cada anticipo por colaborador y requerimiento, haces seguimiento de lo que falta y lo marcas como legalizado cuando llegan los soportes.",
  },
  {
    target: "indicadores",
    title: "El estado de un vistazo",
    description:
      "Cuántos anticipos están atrasados, cuántos siguen sin resolver y por qué valor, las devoluciones, los legalizados y los de excolaboradores. Haz clic en uno para filtrar la tabla.",
    side: "bottom",
  },
  {
    target: "importar",
    title: "Cruza los excolaboradores",
    description:
      "Importa el reporte de retirados de Contabilidad. Los anticipos de excolaboradores quedan marcados en la tabla y en los indicadores ves el valor que tienen pendiente. Actualízalo cuando llegue un reporte nuevo.",
    side: "bottom",
  },
  {
    target: "nuevo",
    title: "1. Registra un anticipo",
    description:
      "Abre el formulario con el colaborador, el código de requerimiento, el valor, la fecha de RQ, qué falta y la observación de seguimiento.",
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
      "Filtra por el semáforo (atrasados, en plazo, resueltos), por lo que falta, por la observación de seguimiento o deja solo los excolaboradores. Limpiar filtros vuelve a la vista completa.",
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
      "Haz clic en una fila para ver el detalle en el panel lateral: desde ahí lo editas, lo legalizas o lo eliminas. Con «Legalizar» al final de la fila lo cierras sin abrirlo. Por defecto va primero lo atrasado; haz clic en un encabezado para ordenar por esa columna y arrastra su borde para ajustar el ancho (doble clic lo restablece).",
    side: "bottom",
  },
];

import type { TourStep } from "@/components/tour/como-usar";

/** Recorrido "¿Cómo usar?" de Servicios públicos. */
export const TOUR_SERVICIOS_PUBLICOS: TourStep[] = [
  {
    title: "Servicios públicos",
    description:
      "Aquí sigues cada recibo desde que se espera la factura hasta que Tesorería lo paga y adjuntas el soporte. El estado cambia solo según las fechas que registras.",
  },
  {
    target: "indicadores",
    title: "Lo que necesita tu atención",
    description:
      "Recibos que requieren revisión (un plazo ya pasó), facturas que aún no llegan y recibos pendientes de pago, de todos los meses. Haz clic en un indicador para filtrar la tabla.",
    side: "bottom",
  },
  {
    target: "meses",
    title: "Conteo por mes",
    description:
      "Cuántos recibos se registraron en cada mes, sin contar a mano. Elige un mes para ver sus recibos; los meses anteriores quedan como histórico.",
    side: "bottom",
  },
  {
    target: "servicios",
    title: "1. Tus servicios",
    description:
      "Agrega cada servicio que llega cada mes, con su referencia y día de corte. Con eso el portal crea los recibos esperados del mes y te avisa si una factura no llega.",
    side: "bottom",
  },
  {
    target: "tabla",
    title: "2. Sigue cada recibo",
    description:
      "El semáforo dice qué revisar: rojo si un plazo pasó, amarillo si se acerca o falta algo, verde si está al día. El botón de cada fila es el siguiente paso: llegó la factura, registrar, marcar pagado o adjuntar el soporte.",
    side: "top",
  },
];

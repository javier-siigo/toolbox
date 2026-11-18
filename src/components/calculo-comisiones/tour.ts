import type { TourStep } from "@/components/tour/como-usar";

/** Recorrido "¿Cómo usar?" del cierre mensual de comisiones. */
export const TOUR_COMISIONES: TourStep[] = [
  {
    title: "Cierre mensual de comisiones",
    description:
      "Las comisiones de cada mes se llevan al gasto al mismo ritmo en que se reconoce el ingreso de las facturas F93 y F94 de ese mes. Solo tienes que traer tres datos; el resultado se calcula solo.",
  },
  {
    target: "periodo",
    title: "Elige el mes",
    description:
      "Con las flechas o la lista. Los meses que ya tienen un cierre guardado vienen marcados en la lista.",
    side: "bottom",
  },
  {
    target: "dato-comisiones",
    title: "1. Comisiones del mes",
    description:
      "El valor de cada concepto de comisión con su cuenta de gasto. Si el mes está vacío, puedes copiar el mes anterior y ajustarlo.",
    side: "bottom",
  },
  {
    target: "dato-facturacion",
    title: "2. Facturación F93/F94",
    description:
      "Las facturas y notas crédito F93/F94 emitidas en el mes según NetSuite. Pasa el mouse por los términos subrayados para ver qué significan.",
    side: "bottom",
  },
  {
    target: "dato-informe",
    title: "3. Informe diferido",
    description:
      "Arrastra el Excel mensual a cualquier parte de la página o súbelo desde aquí. Se lee en tu navegador.",
    side: "bottom",
  },
  {
    target: "resultado",
    title: "Resultado del mes",
    description:
      "El gasto del mes en una cifra. \"¿Por qué este número?\" muestra la cuenta. A la derecha, lo que hay que revisar: cada punto trae un botón que te lleva a resolverlo.",
    side: "top",
  },
  {
    target: "detalle",
    title: "Ver detalle",
    description:
      "El cálculo por cohorte, los asientos para NetSuite con su botón Copiar, todos los controles y los comprobantes del informe.",
    side: "top",
  },
  {
    target: "seguimiento",
    title: "Seguimiento",
    description:
      "La matriz histórica por cohorte y los cierres guardados. Desde ahí abres cualquier mes para revisarlo.",
    side: "bottom",
  },
];

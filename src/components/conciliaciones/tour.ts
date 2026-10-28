import type { TourStep } from "@/components/tour/como-usar";

/** Recorrido "¿Cómo usar?" de la conciliación bancaria de un país. */
export function tourConciliaciones(
  pais: string,
  opts: { conTxt?: boolean } = {},
): TourStep[] {
  const pasoTxt: TourStep[] = opts.conTxt
    ? [
        {
          target: "txt",
          title: "Extracto en TXT (opcional)",
          description:
            "Si el banco te entregó el extracto en uno o varios .txt, selecciónalos juntos. Se consolidan en un solo Excel que queda cargado como extracto bancario; también puedes descargarlo. Si algún TXT no se pudo leer, aparece listado debajo.",
          side: "bottom",
        },
      ]
    : [];
  return [
    {
      title: `Conciliación ${pais}`,
      description:
        "Concilia el extracto de un banco: eliges el banco, subes los archivos y descargas el Excel conciliado.",
    },
    {
      target: "banco",
      title: "1. Elige el banco",
      description:
        "Búscalo por nombre. Cada banco tiene su propia regla de conciliación, así que elige el del extracto que vas a subir. Si cambias de banco, se descarta el resultado anterior.",
      side: "bottom",
    },
    ...pasoTxt,
    {
      target: "extracto",
      title: "2. Sube el extracto bancario",
      description:
        "Es obligatorio. Arrástralo o haz clic para elegirlo (.xlsx, .xls o .csv, hasta 10 MB). Puedes quitarlo con la X si te equivocaste.",
      side: "top",
    },
    {
      target: "previo",
      title: "Conciliación anterior (opcional)",
      description:
        "Si tienes el Excel de la conciliación anterior que entregan los contadores (.xlsx), súbelo aquí para que se tenga en cuenta. Si no, deja este espacio vacío y procesa solo con el extracto.",
      side: "top",
    },
    {
      target: "procesar",
      title: "3. Procesa y descarga",
      description:
        "El botón se activa cuando hay banco y extracto. La conciliación puede tardar unos minutos; no cierres la pestaña. Al terminar aparece Descargar con el Excel conciliado.",
      side: "top",
    },
  ];
}

"use client";

import { CircleHelp, MapPin } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Términos del proceso explicados en palabras simples. */
export const GLOSARIO = {
  cohorte:
    "Las comisiones causadas en un mes. No van al gasto de una vez: se llevan poco a poco, al mismo ritmo en que se reconoce el ingreso de las facturas F93/F94 de ese mes.",
  diferido:
    "La parte de las comisiones que todavía no se ha llevado al gasto. Espera en la cuenta 17109501 hasta que se reconozca el ingreso de sus facturas.",
  f93f94:
    "Los prefijos de las facturas que generan comisión. Solo su ingreso cuenta para calcular el gasto.",
  informe:
    "El Excel mensual con el ingreso reconocido de cada factura. Dice cuánto ingreso de cada mes de facturas se reconoció este mes.",
  ajuste:
    "Cuando las facturas de un mes ya no tienen ingreso por reconocer, la comisión que seguía diferida se lleva toda al gasto en un asiento aparte.",
  tope: "Nunca se lleva al gasto más de lo causado. El último mes de una cohorte se registra solo lo que faltaba.",
  neto: "Facturas menos notas crédito.",
} as const;

export type TerminoGlosario = keyof typeof GLOSARIO;

/** Palabra con su definición al pasar el mouse o al enfocarla con el teclado. */
export function Termino({
  t,
  children,
}: {
  t: TerminoGlosario;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="cursor-help underline decoration-muted-foreground/60 decoration-dotted underline-offset-[3px] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-xs leading-relaxed">{GLOSARIO[t]}</TooltipContent>
    </Tooltip>
  );
}

/** Ayuda de un dato: qué es y de dónde sacarlo. */
export function AyudaDato({ que, donde }: { que: React.ReactNode; donde: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <AyudaItem icon={CircleHelp} titulo="¿Qué es?">
        {que}
      </AyudaItem>
      <AyudaItem icon={MapPin} titulo="¿De dónde lo saco?">
        {donde}
      </AyudaItem>
    </div>
  );
}

function AyudaItem({
  icon: Icon,
  titulo,
  children,
}: {
  icon: typeof CircleHelp;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5 rounded-md bg-primary/[0.06] px-3 py-2.5 text-sm dark:bg-primary/10">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="text-pretty">
        <span className="font-medium">{titulo}</span>{" "}
        <span className="text-muted-foreground">{children}</span>
      </p>
    </div>
  );
}

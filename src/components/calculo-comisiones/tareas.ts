import { periodoLabel, type CierreCalculo } from "@/lib/comisiones/calculo";
import type { Control, EstadoControl } from "@/lib/comisiones/types";

/** Dónde se resuelve una tarea. */
export type DestinoTarea =
  | { tipo: "dato"; dato: DatoMes }
  | { tipo: "detalle"; vista: "cohortes" | "asientos" | "controles" }
  | { tipo: "periodo"; periodo: string };

export type DatoMes = "comisiones" | "facturacion" | "informe";

export interface Tarea {
  id: string;
  estado: Extract<EstadoControl, "error" | "warning">;
  /** Qué hacer, dicho como una acción. */
  titulo: string;
  detalle: string;
  boton: string;
  destino: DestinoTarea;
}

/**
 * Convierte los controles en error o para revisar en tareas: qué hacer y un
 * botón que lleva al lugar donde se resuelve. Los controles correctos o
 * informativos quedan en el detalle.
 */
export function construirTareas(controles: Control[], cierre: CierreCalculo): Tarea[] {
  const mes = periodoLabel(cierre.periodo).toLowerCase();
  const out: Tarea[] = [];
  for (const c of controles) {
    if (c.estado !== "error" && c.estado !== "warning") continue;
    const t = traducir(c, cierre, mes);
    out.push({ id: c.id, estado: c.estado, detalle: c.detalle, ...t });
  }
  // Primero lo que impide guardar.
  return out.sort((a, b) => (a.estado === b.estado ? 0 : a.estado === "error" ? -1 : 1));
}

function traducir(
  c: Control,
  cierre: CierreCalculo,
  mes: string,
): Pick<Tarea, "titulo" | "boton" | "destino"> {
  const informe = { tipo: "dato", dato: "informe" } as const;
  const detalle = (vista: "cohortes" | "asientos" | "controles") => ({ tipo: "detalle", vista }) as const;
  switch (c.id) {
    case "periodo":
      return c.estado === "error"
        ? { titulo: `Carga el informe diferido de ${mes}`, boton: "Cambiar archivo", destino: informe }
        : { titulo: "Confirma que el informe sea del mes", boton: "Ver archivo", destino: informe };
    case "sin-fecha":
      return {
        titulo: "Pide el informe con la fecha de factura completa",
        boton: "Ver archivo",
        destino: informe,
      };
    case "periodos-mezclados":
      return { titulo: "Confirma que el informe sea el correcto", boton: "Ver archivo", destino: informe };
    case "doc-origen":
      return { titulo: "El informe no trae la columna DOC ORIGEN", boton: "Ver archivo", destino: informe };
    case "saldo":
      return { titulo: "Revisa líneas del informe que no cuadran", boton: "Ver controles", destino: detalle("controles") };
    case "comisiones-mes":
      return {
        titulo: `Registra las comisiones causadas en ${mes}`,
        boton: "Registrar",
        destino: { tipo: "dato", dato: "comisiones" },
      };
    case "base-mes":
      return {
        titulo: `Ingresa la facturación F93/F94 de ${mes}`,
        boton: "Ingresar",
        destino: { tipo: "dato", dato: "facturacion" },
      };
    case "sin-base": {
      const primera = cierre.cohortes.find((k) => !k.esPropia && k.alertas.includes("sin-base"));
      return primera
        ? {
            titulo: "Completa la facturación de meses anteriores",
            boton: `Ir a ${periodoLabel(primera.cohorte).toLowerCase()}`,
            destino: { tipo: "periodo", periodo: primera.cohorte },
          }
        : { titulo: "Completa la facturación de meses anteriores", boton: "Ver cohortes", destino: detalle("cohortes") };
    }
    case "sin-cuenta":
      return {
        titulo: "Asigna la cuenta contable que falta",
        boton: "Asignar cuenta",
        destino: { tipo: "dato", dato: "comisiones" },
      };
    case "asientos":
      return { titulo: "Hay asientos que no cuadran", boton: "Ver asientos", destino: detalle("asientos") };
    case "difiere":
      return {
        titulo: "El informe trae un ingreso distinto al ya registrado",
        boton: "Ver cohortes",
        destino: detalle("cohortes"),
      };
    case "cierre":
      return {
        titulo: "Pide el soporte del ajuste de cierre",
        boton: "Ver cohortes",
        destino: detalle("cohortes"),
      };
    case "sin-ingreso":
      return {
        titulo: "Confirma las cohortes sin ingreso este mes",
        boton: "Ver cohortes",
        destino: detalle("cohortes"),
      };
    case "negativo":
      return { titulo: "Revisa el gasto negativo (reversa)", boton: "Ver cohortes", destino: detalle("cohortes") };
    case "diferencia-guardado":
      return {
        titulo: "Registra la diferencia con el cierre guardado",
        boton: "Ver cohortes",
        destino: detalle("cohortes"),
      };
    default:
      return { titulo: c.titulo, boton: "Ver controles", destino: detalle("controles") };
  }
}

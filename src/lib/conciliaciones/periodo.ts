/**
 * Periodo de conciliación de un banco. Seguro para cliente y servidor.
 *
 * Los contadores configuran por banco el mes que concilian (`periodo`) y la fecha de
 * cierre hasta la que se sigue trabajando ese mes (`cierre`). Regla:
 *   - hoy ≤ cierre   → se concilia el mes configurado (p. ej. noviembre hasta el 3 de diciembre)
 *   - si no / vacío  → se concilia el mes en curso del país
 * Solo cuentan los registros con fecha entre `desde` y `hasta` (el mes completo).
 */

const ZONA_POR_PAIS: Record<string, string> = {
  CO: "America/Bogota",
  MX: "America/Mexico_City",
  UY: "America/Montevideo",
  EC: "America/Guayaquil",
  CL: "America/Santiago",
};

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export interface PeriodoConfig {
  /** `YYYY-MM-01` o null. */
  periodo: string | null;
  /** `YYYY-MM-DD` o null. */
  cierre: string | null;
}

export interface PeriodoVigente {
  /** `YYYY-MM` */
  mes: string;
  /** Primer día del mes, `YYYY-MM-DD`. */
  desde: string;
  /** Último día del mes, `YYYY-MM-DD`. */
  hasta: string;
  /** Fecha de cierre configurada, si aplica. */
  cierre: string | null;
  /** false: no hay configuración vigente y se usa el mes en curso. */
  configurado: boolean;
}

/** Fecha de hoy (`YYYY-MM-DD`) en la zona horaria del país. */
export function hoyEnPais(pais: string, ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_POR_PAIS[pais] ?? "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

/** `YYYY-MM[-DD]` → números (0 si falta una parte). */
function partes(fecha: string): [number, number, number] {
  const [y = 0, m = 0, d = 0] = fecha.split("-").map(Number);
  return [y, m, d];
}

export function ultimoDiaDelMes(mes: string): string {
  const [y, m] = partes(mes);
  const dia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mes}-${String(dia).padStart(2, "0")}`;
}

export function periodoVigente(config: PeriodoConfig, hoy: string): PeriodoVigente {
  const vigente = config.periodo && config.cierre && hoy <= config.cierre;
  const mes = vigente ? config.periodo!.slice(0, 7) : hoy.slice(0, 7);
  return {
    mes,
    desde: `${mes}-01`,
    hasta: ultimoDiaDelMes(mes),
    cierre: vigente ? config.cierre : null,
    configurado: Boolean(vigente),
  };
}

/**
 * Campos que reciben los flujos de n8n. Solo deben tener en cuenta los registros con
 * fecha entre `periodoDesde` y `periodoHasta` (inclusive).
 */
export function appendPeriodo(form: FormData, p: PeriodoVigente): void {
  form.append("periodo", p.mes);
  form.append("periodoDesde", p.desde);
  form.append("periodoHasta", p.hasta);
  if (p.cierre) form.append("periodoCierre", p.cierre);
}

export function nombreMes(mes: string, conAnio = true): string {
  const [y, m] = partes(mes);
  const nombre = MESES[m - 1] ?? mes;
  return conAnio ? `${nombre} ${y}` : nombre;
}

/** `2026-12-03` → `3 de diciembre`. */
export function fechaLarga(fecha: string): string {
  const [, m, d] = partes(fecha);
  return `${d} de ${MESES[m - 1] ?? ""}`;
}

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const FECHA_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Valida mes (`YYYY-MM`) y cierre (`YYYY-MM-DD`). Devuelve el error o null. */
export function validarPeriodo(mes: string, cierre: string): string | null {
  if (!MES_RE.test(mes)) return "Elige el mes que se concilia.";
  if (!FECHA_RE.test(cierre) || Number.isNaN(Date.parse(cierre))) {
    return "Elige la fecha de cierre.";
  }
  if (cierre < ultimoDiaDelMes(mes)) {
    return `El cierre no puede ser antes del ${fechaLarga(ultimoDiaDelMes(mes))}.`;
  }
  return null;
}

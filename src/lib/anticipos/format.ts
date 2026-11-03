const CURRENCY_FORMATTER = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const CEDULA_FORMATTER = new Intl.NumberFormat("es-CO");

export function formatAnticipoCurrency(value: number | null | undefined): string | null {
  if (value == null) return null;
  return CURRENCY_FORMATTER.format(value);
}

export function formatAnticipoCedula(value: number): string {
  return CEDULA_FORMATTER.format(value);
}

const FECHA = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-10-05" → "05 oct 2026" (sin los "de" que agrega es-CO). */
export function formatAnticipoFecha(value: string | null | undefined): string {
  if (!value) return "—";
  const partes = FECHA.formatToParts(new Date(`${value}T00:00:00Z`));
  const parte = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((p) => p.type === tipo)?.value.replace(".", "") ?? "";
  return `${parte("day")} ${parte("month")} ${parte("year")}`;
}

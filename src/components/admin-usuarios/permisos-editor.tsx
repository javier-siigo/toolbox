"use client";

import { Check, Lock, ShieldCheck } from "lucide-react";

import type { Nivel, ProcesoId } from "@/lib/auth/permisos-shared";
import { FlagIcon } from "@/lib/flags";
import { cn } from "@/lib/utils";

import {
  AREAS_CON_PERMISOS,
  NIVELES,
  NIVEL_META,
  accessFor,
  nivelArea,
  setNivel,
  setNivelArea,
  type Draft,
} from "./helpers";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

const OPCIONES: { value: Nivel | null; label: string; title: string }[] = [
  { value: null, label: "—", title: "Sin acceso" },
  ...NIVELES.map((n) => ({ value: n, label: NIVEL_META[n].label, title: NIVEL_META[n].description })),
];

export function PermisosEditor({
  draft,
  onChange,
  isSelf = false,
  disabled = false,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  /** El admin editándose a sí mismo no puede quitarse el acceso de administrador. */
  isSelf?: boolean;
  disabled?: boolean;
}) {
  const locked = isSelf && draft.esAdmin;

  return (
    <div className="flex flex-col gap-6">
      <fieldset disabled={disabled}>
        <legend className="sr-only">Administrador</legend>
        <button
          type="button"
          role="checkbox"
          aria-checked={draft.esAdmin}
          aria-disabled={locked || undefined}
          onClick={() => !locked && onChange({ ...draft, esAdmin: !draft.esAdmin })}
          className={cn(
            "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            FOCUS,
            draft.esAdmin ? "border-primary/50 bg-primary/5" : "border-border bg-background hover:border-ring/50",
            locked && "cursor-default",
          )}
        >
          <span
            className={cn(
              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
              draft.esAdmin
                ? "border-primary/20 bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            <ShieldCheck className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-center justify-between gap-2 text-sm font-medium text-foreground">
              Administrador
              {locked ? (
                <Lock className="size-3.5 text-muted-foreground" aria-hidden />
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 items-center justify-center rounded-sm border transition-colors",
                    draft.esAdmin ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card",
                  )}
                >
                  {draft.esAdmin && <Check className="size-3" strokeWidth={3} />}
                </span>
              )}
            </span>
            <span className="text-xs leading-snug text-muted-foreground">
              {locked
                ? "No puedes quitarte tu propio acceso de administrador."
                : "Acceso total a todos los procesos y a esta pantalla."}
            </span>
          </span>
        </button>
      </fieldset>

      {AREAS_CON_PERMISOS.map((area) => {
        const comun = nivelArea(draft, area);
        return (
          <fieldset key={area.slug} disabled={disabled || draft.esAdmin} className="flex flex-col gap-2">
            <legend className="mb-2 flex w-full items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <area.icon className="size-3.5" aria-hidden />
                {area.label}
              </span>
              <NivelSelector
                label={`Nivel para toda el área ${area.label}`}
                value={comun === "mixto" ? undefined : comun}
                onChange={(n) => onChange(setNivelArea(draft, area, n))}
                // El <legend> no hereda el `disabled` del fieldset: se pasa explícito.
                disabled={disabled || draft.esAdmin}
                compact
              />
            </legend>
            <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
              {area.procesos.map((p) => (
                <li key={p.slug} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                    {p.flagCode && (
                      <FlagIcon code={p.flagCode} className="h-3 w-[18px] shrink-0 rounded-[2px] ring-1 ring-black/10" />
                    )}
                    <span className="truncate">{p.label}</span>
                  </span>
                  <NivelSelector
                    label={`Nivel en ${p.label}`}
                    value={draft.procesos[p.id as ProcesoId] ?? null}
                    onChange={(n) => onChange(setNivel(draft, p.id!, n))}
                  />
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
      {draft.esAdmin && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Como administrador ya tiene nivel Gestionar en todo; los permisos por proceso no aplican.
        </p>
      )}

      <AccessPreview draft={draft} />
    </div>
  );
}

/** Control segmentado —/Ver/Usar/Gestionar. `undefined` = sin selección (área con niveles mixtos). */
function NivelSelector({
  label,
  value,
  onChange,
  disabled,
  compact = false,
}: {
  label: string;
  value: Nivel | null | undefined;
  onChange: (n: Nivel | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <span role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-md border border-border bg-muted/40 p-0.5">
      {OPCIONES.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-[5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              FOCUS,
              compact ? "h-6 px-1.5 text-[11px]" : "h-7 px-2 text-xs",
              active
                ? o.value === null
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                  : "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

function AccessPreview({ draft }: { draft: Draft }) {
  const areas = accessFor(draft);
  return (
    <section
      aria-live="polite"
      className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-muted/40 p-3"
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Lo que verá en el portal
      </h3>
      {areas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Solo Inicio y Documentación general. Dale acceso a un proceso para que lo vea.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {areas.map((area) => (
            <li key={area.slug} className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <area.icon className="size-3.5 text-muted-foreground" aria-hidden />
                {area.label}
              </span>
              <span className="flex flex-wrap gap-1 pl-5">
                {area.procesos.map((p) => {
                  const nivel = draft.esAdmin ? "gestionar" : p.id ? draft.procesos[p.id] : undefined;
                  return (
                    <span
                      key={p.slug}
                      className="inline-flex items-center gap-1 rounded-sm bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border"
                    >
                      {p.flagCode && <FlagIcon code={p.flagCode} className="h-2.5 w-[15px] rounded-[1px]" />}
                      {p.label}
                      {nivel && <span className="text-foreground/70">· {NIVEL_META[nivel].label}</span>}
                    </span>
                  );
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

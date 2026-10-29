"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronRight, Copy, RotateCcw, Save, UserX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { updatePermisos } from "@/lib/admin/users";
import { FlagIcon } from "@/lib/flags";
import { cn } from "@/lib/utils";

import {
  AREAS_CON_PERMISOS,
  EMPTY_DRAFT,
  diffLabels,
  displayName,
  isDirty,
  isInactive,
  lastActivity,
  issuesFor,
  type AdminUser,
  type Draft,
} from "./helpers";
import { PermisosEditor } from "./permisos-editor";
import {
  FILTERS,
  FilterChips,
  FlagStrip,
  IssueBadge,
  PermisoChips,
  SearchBox,
  TimeAgo,
  UserAvatar,
  UserIdentity,
  matches,
  type Filter,
} from "./user-bits";

const toDrafts = (users: AdminUser[]) =>
  Object.fromEntries(users.map((u) => [u.id, { esAdmin: u.esAdmin, procesos: u.procesos }])) as Record<string, Draft>;

export function UsuariosPage({ users, currentUserId }: { users: AdminUser[]; currentUserId: string }) {
  const router = useRouter();
  const [saved, setSaved] = React.useState(() => toDrafts(users));
  const [drafts, setDrafts] = React.useState(() => toDrafts(users));
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("todos");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [savingId, setSavingId] = React.useState<string | null>(null);

  // Cuando el servidor devuelve datos frescos, adopta su verdad sin pisar ediciones en curso.
  React.useEffect(() => {
    const fresh = toDrafts(users);
    setSaved(fresh);
    setDrafts((prev) =>
      Object.fromEntries(
        users.map((u) => {
          const p = prev[u.id];
          const f = fresh[u.id] ?? EMPTY_DRAFT;
          return [u.id, p && isDirty(f, p) ? p : f];
        }),
      ),
    );
  }, [users]);

  const savedOf = (id: string) => saved[id] ?? EMPTY_DRAFT;
  const draftOf = (id: string) => drafts[id] ?? EMPTY_DRAFT;
  const issuesOf = (u: AdminUser) => issuesFor(savedOf(u.id));

  const pending = users.filter((u) => issuesOf(u).length > 0);
  const visible = users.filter((u) => matches(u, savedOf(u.id), query, filter, issuesOf(u)));
  const counts: Record<Filter, number> = Object.fromEntries(
    FILTERS.map((f) => [f.id, users.filter((u) => matches(u, savedOf(u.id), "", f.id, issuesOf(u))).length]),
  );

  const save = async (id: string) => {
    const d = draftOf(id);
    setSavingId(id);
    try {
      const result = await updatePermisos({ userId: id, esAdmin: d.esAdmin, procesos: d.procesos });
      if (!result.ok) {
        toast.error(result.error);
        return false;
      }
      setSaved((prev) => ({ ...prev, [id]: d }));
      const u = users.find((x) => x.id === id);
      toast.success(`Permisos de ${u ? displayName(u.email) : "usuario"} actualizados`);
      router.refresh();
      return true;
    } finally {
      setSavingId(null);
    }
  };

  const open = users.find((u) => u.id === openId) ?? null;

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center">
        <span className="flex size-10 items-center justify-center rounded-full border bg-muted">
          <UserX className="size-4 text-muted-foreground" />
        </span>
        <p className="text-sm font-semibold text-foreground">Todavía no hay usuarios</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Las personas aparecen aquí después de crear su cuenta en el portal. Luego podrás darles acceso a procesos.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <PendingPanel
          pending={pending}
          total={users.length}
          issuesOf={issuesOf}
          onResolve={setOpenId}
          onShowAll={() => setFilter("atencion")}
        />
        <CoveragePanel users={users} savedOf={savedOf} counts={counts} onPick={setOpenId} />
      </div>

      <section aria-label="Usuarios" className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-center lg:justify-between">
          <FilterChips value={filter} onChange={setFilter} counts={counts} />
          <SearchBox value={query} onChange={setQuery} className="lg:w-64" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm md:min-w-[720px]">
            <thead>
              <tr className="h-9 border-b border-border bg-muted/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="px-4">Usuario</th>
                <th scope="col" className="hidden px-4 md:table-cell">Acceso</th>
                <th scope="col" className="hidden px-4 md:table-cell">Última actividad</th>
                <th scope="col" className="w-12 px-4">
                  <span className="sr-only">Editar</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Ningún usuario coincide con el filtro.{" "}
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      onClick={() => {
                        setQuery("");
                        setFilter("todos");
                      }}
                    >
                      Ver todos
                    </button>
                  </td>
                </tr>
              )}
              {visible.map((u) => {
                const dirty = isDirty(savedOf(u.id), draftOf(u.id));
                return (
                  <tr
                    key={u.id}
                    onClick={() => setOpenId(u.id)}
                    className={cn(
                      "cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-muted/40",
                      openId === u.id && "bg-primary/5",
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <UserIdentity user={u} isSelf={u.id === currentUserId} />
                      <AccessSummary className="mt-2 pl-11 md:hidden" draft={savedOf(u.id)} issues={issuesOf(u)} dirty={dirty} />
                    </td>
                    <td className="hidden px-4 py-2.5 md:table-cell">
                      <AccessSummary draft={savedOf(u.id)} issues={issuesOf(u)} dirty={dirty} />
                    </td>
                    <td
                      className={cn(
                        "hidden px-4 py-2.5 text-xs whitespace-nowrap md:table-cell",
                        isInactive(lastActivity(u)) ? "text-muted-foreground/70" : "text-muted-foreground",
                      )}
                    >
                      <TimeAgo iso={lastActivity(u)} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        aria-label={`Editar permisos de ${displayName(u.email)}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenId(u.id);
                        }}
                      >
                        <ChevronRight />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <EditorSurface open={open !== null} onOpenChange={(v) => !v && setOpenId(null)} user={open}>
        {open && (
          <EditorBody
            key={open.id}
            user={open}
            isSelf={open.id === currentUserId}
            saved={savedOf(open.id)}
            draft={draftOf(open.id)}
            saving={savingId === open.id}
            onChange={(d) => setDrafts((prev) => ({ ...prev, [open.id]: d }))}
            onDiscard={() => setDrafts((prev) => ({ ...prev, [open.id]: savedOf(open.id) }))}
            onSave={async () => {
              if (await save(open.id)) setOpenId(null);
            }}
          />
        )}
      </EditorSurface>
    </div>
  );
}

function AccessSummary({
  draft,
  issues,
  dirty,
  className,
}: {
  draft: Draft;
  issues: string[];
  dirty: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex flex-wrap items-center gap-2", className)}>
      <PermisoChips draft={draft} />
      <FlagStrip draft={draft} />
      <IssueBadge issues={issues} />
      {dirty && <span className="text-[11px] font-medium text-primary">Cambios sin guardar</span>}
    </span>
  );
}

function PendingPanel({
  pending,
  total,
  issuesOf,
  onResolve,
  onShowAll,
}: {
  pending: AdminUser[];
  total: number;
  issuesOf: (u: AdminUser) => string[];
  onResolve: (id: string) => void;
  onShowAll: () => void;
}) {
  const MAX = 4;
  return (
    <section aria-labelledby="pendientes" className="flex flex-col rounded-lg border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <h2 id="pendientes" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {pending.length > 0 ? (
            <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
          ) : (
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          )}
          Para revisar
        </h2>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {pending.length} de {total}
        </span>
      </header>
      {pending.length === 0 ? (
        <p className="flex flex-1 items-center px-5 py-6 text-sm text-muted-foreground">
          Todo el equipo tiene permisos coherentes. Nada pendiente.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {pending.slice(0, MAX).map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => onResolve(u.id)}
                className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="truncate font-medium text-foreground">{displayName(u.email)}</span>
                  <span className="truncate text-muted-foreground">{issuesOf(u).join(" · ")}</span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                  Resolver <ChevronRight className="size-3.5" aria-hidden />
                </span>
              </button>
            </li>
          ))}
          {pending.length > MAX && (
            <li>
              <button
                type="button"
                onClick={onShowAll}
                className="w-full px-5 py-2.5 text-left text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                Ver los {pending.length} en la tabla
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function CoveragePanel({
  users,
  savedOf,
  counts,
  onPick,
}: {
  users: AdminUser[];
  savedOf: (id: string) => Draft;
  counts: Record<Filter, number>;
  onPick: (id: string) => void;
}) {
  const MAX = 4;
  const resumen = FILTERS.filter((f) => f.id !== "todos" && f.id !== "atencion");
  return (
    <section aria-labelledby="cobertura" className="flex flex-col rounded-lg border border-border bg-card shadow-sm">
      <header className="border-b border-border px-5 py-3">
        <h2 id="cobertura" className="text-sm font-semibold text-foreground">
          Cobertura
        </h2>
      </header>
      <div className="flex flex-1 flex-col gap-4 px-5 py-4">
        <dl className="grid grid-cols-3 gap-3">
          {resumen.map((f) => (
            <div key={f.id} className="flex flex-col gap-1">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</dt>
              <dd className="font-mono text-lg font-semibold leading-none tabular-nums text-foreground">
                {counts[f.id] ?? 0}
              </dd>
            </div>
          ))}
        </dl>
        <ul className="flex flex-col gap-1.5" aria-label="Personas con acceso por proceso (sin contar admins)">
          {AREAS_CON_PERMISOS.flatMap((a) => a.procesos).map((proc) => {
            const people = users.filter((u) => !savedOf(u.id).esAdmin && savedOf(u.id).procesos[proc.id!]);
            return (
              <li key={proc.id} className="flex min-h-7 items-center gap-2 text-xs">
                {proc.flagCode ? (
                  <FlagIcon code={proc.flagCode} className="h-3 w-[18px] shrink-0 rounded-[2px] ring-1 ring-black/10" />
                ) : (
                  <proc.icon className="size-3.5 w-[18px] shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="w-32 shrink-0 truncate text-muted-foreground" title={proc.label}>
                  {proc.label}
                </span>
                {people.length === 0 ? (
                  <span className="font-medium text-amber-700 dark:text-amber-400">Sin cobertura</span>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center">
                    {people.slice(0, MAX).map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        title={displayName(p.email)}
                        aria-label={`Editar ${displayName(p.email)}`}
                        onClick={() => onPick(p.id)}
                        className={cn(
                          "relative rounded-full ring-2 ring-card transition-transform duration-[var(--duration-enter)] ease-[var(--easing-enter)] hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-ring",
                          i > 0 && "-ml-1",
                        )}
                      >
                        <UserAvatar email={p.email} className="size-7" />
                      </button>
                    ))}
                    {people.length > MAX && (
                      <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                        +{people.length - MAX}
                      </span>
                    )}
                    <span className="ml-2 truncate text-muted-foreground">
                      {people.length === 1
                        ? `Solo ${displayName(people[0]!.email)}`
                        : people.length <= 3
                          ? people.map((p) => displayName(p.email).split(" ")[0]).join(", ")
                          : `${people.length} personas`}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Hoja lateral en escritorio; Drawer inferior bajo 768px (regla de la superficie). */
function EditorSurface({
  open,
  onOpenChange,
  user,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AdminUser | null;
  children: React.ReactNode;
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const title = user ? `Permisos de ${displayName(user.email)}` : "Permisos";

  if (isDesktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="sr-only">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>Procesos a los que tiene acceso y con qué nivel.</SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Drawer open={open} onOpenChange={(v) => onOpenChange(v)}>
      <DrawerContent className="overflow-hidden">
        <DrawerHeader className="sr-only">
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>Procesos a los que tiene acceso y con qué nivel.</DrawerDescription>
        </DrawerHeader>
        {children}
      </DrawerContent>
    </Drawer>
  );
}

function EditorBody({
  user,
  isSelf,
  saved,
  draft,
  saving,
  onChange,
  onDiscard,
  onSave,
}: {
  user: AdminUser;
  isSelf: boolean;
  saved: Draft;
  draft: Draft;
  saving: boolean;
  onChange: (d: Draft) => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const diff = diffLabels(saved, draft);
  const [copied, setCopied] = React.useState(false);

  const copyId = async () => {
    await navigator.clipboard?.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border px-5 py-4 pr-12">
        <UserIdentity user={user} isSelf={isSelf} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-11 text-xs text-muted-foreground">
          <TimeAgo iso={lastActivity(user)} prefix="Activo: " />
          <TimeAgo iso={user.lastSignInAt} prefix="Inicio de sesión: " />
          <button
            type="button"
            onClick={copyId}
            className="inline-flex items-center gap-1 rounded-sm font-mono hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Copiar ID de usuario"
          >
            <Copy className="size-3" aria-hidden />
            {copied ? "Copiado" : user.id.slice(0, 8)}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <PermisosEditor draft={draft} onChange={onChange} isSelf={isSelf} disabled={saving} />
      </div>

      <div
        className={cn(
          "flex flex-col gap-3 border-t border-border px-5 py-3 transition-colors",
          diff.length > 0 && "bg-primary/5",
        )}
      >
        <div className="flex min-h-5 flex-wrap items-center gap-1.5 text-xs" aria-live="polite">
          {diff.length === 0 ? (
            <span className="text-muted-foreground">Sin cambios</span>
          ) : (
            diff.map((c) => (
              <span
                key={c.sign + c.label}
                className={cn(
                  "rounded-sm px-1.5 py-0.5 font-medium",
                  c.sign === "+"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : c.sign === "~"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground line-through",
                )}
              >
                {c.sign === "~" ? c.label : `${c.sign} ${c.label}`}
              </span>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={diff.length === 0 || saving} onClick={onDiscard}>
            <RotateCcw />
            Descartar
          </Button>
          <Button size="sm" disabled={diff.length === 0 || saving} onClick={onSave}>
            <Save />
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </div>
    </div>
  );
}

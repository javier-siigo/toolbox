"use client";

import { usePathname } from "next/navigation";

import { SidebarTrigger } from "@/components/ui/sidebar";
import type { Permisos } from "@/lib/auth/permisos-shared";
import { findArea, findProceso } from "@/lib/navigation";

import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

interface TopbarProps {
  user: { name: string; email: string };
  permisos: Permisos;
}

interface ContextInfo {
  eyebrow?: string;
  title: string;
}

function resolveContext(pathname: string | null): ContextInfo | null {
  if (!pathname) return null;

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const [first, second] = segments;

  if (first === "dashboard") {
    return { eyebrow: "Catálogo", title: "Inicio" };
  }

  if (first && second) {
    const proceso = findProceso(first, second);
    if (proceso) {
      const area = findArea(first);
      return { eyebrow: area?.label, title: proceso.label };
    }
    return null;
  }

  // Índice de un área (p. ej. /documentacion).
  const area = first ? findArea(first) : undefined;
  if (area) return { title: area.label };

  return null;
}

export function Topbar({ user, permisos }: TopbarProps) {
  const pathname = usePathname();
  const context = resolveContext(pathname);

  return (
    <header className="app-chrome-topbar sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      <SidebarTrigger className="-ml-1" />
      {context ? (
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {context.eyebrow && (
            <span className="hidden text-xs uppercase tracking-wider text-muted-foreground sm:inline">
              {context.eyebrow}
            </span>
          )}
          <h1 className="min-w-0 truncate text-sm font-semibold text-foreground">
            {context.title}
          </h1>
        </div>
      ) : (
        <div className="flex-1" />
      )}
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserMenu name={user.name} email={user.email} esAdmin={permisos.esAdmin} />
      </div>
    </header>
  );
}

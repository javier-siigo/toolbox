"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, Home, ChevronRight } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Permisos } from "@/lib/auth/permisos-shared";
import { filterAreas } from "@/lib/auth/permisos-shared";
import { FlagIcon } from "@/lib/flags";
import { AREAS, procesoHref } from "@/lib/navigation";

const OPEN_AREAS_KEY = "toolbox:sidebar-areas-open";

function readOpenAreas(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(OPEN_AREAS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function getInitials(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "U"
  );
}

interface AppSidebarProps {
  user: { name: string; email: string };
  permisos: Permisos;
}

export function AppSidebar({ user, permisos }: AppSidebarProps) {
  const visibleAreas = filterAreas(permisos, AREAS).filter((a) => !a.enMenuUsuario);
  const pathname = usePathname();
  const [openAreas, setOpenAreas] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setOpenAreas(readOpenAreas());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(OPEN_AREAS_KEY, JSON.stringify(openAreas));
  }, [openAreas, hydrated]);

  useEffect(() => {
    if (!pathname) return;
    const seg = pathname.split("/").filter(Boolean);
    const currentArea = seg[0];
    if (currentArea && AREAS.some((a) => a.slug === currentArea)) {
      setOpenAreas((prev) =>
        prev[currentArea] ? prev : { ...prev, [currentArea]: true },
      );
    }
  }, [pathname]);

  function toggleArea(slug: string) {
    setOpenAreas((prev) => ({ ...prev, [slug]: !prev[slug] }));
  }

  return (
    <Sidebar collapsible="offcanvas" className="app-chrome-sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip="Toolbox · Portal contable"
              className="data-[active=true]:bg-transparent"
            >
              <Link href="/dashboard" transitionTypes={pathname !== "/dashboard" ? ["nav-back"] : undefined}>
                <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
                  <LayoutDashboard className="size-4" />
                </span>
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm font-semibold">Toolbox</span>
                  <span className="truncate text-[11px] text-sidebar-foreground/70">
                    Portal contable
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMenu className="px-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/dashboard"}
              tooltip="Inicio"
            >
              <Link href="/dashboard" transitionTypes={pathname !== "/dashboard" ? ["nav-back"] : undefined}>
                <Home />
                <span>Inicio</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <SidebarGroup>
          <SidebarGroupLabel className="h-7 px-2 text-[11px] uppercase tracking-wide font-medium text-sidebar-foreground/70">
            Áreas
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleAreas.map((area) => {
                const isOpen = hydrated
                  ? openAreas[area.slug] ?? false
                  : false;
                const hasChildActive = area.procesos.some(
                  (p) => pathname === procesoHref(area.slug, p.slug),
                );

                return (
                  <Collapsible
                    key={area.slug}
                    asChild
                    open={isOpen}
                    onOpenChange={() => toggleArea(area.slug)}
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          tooltip={area.label}
                          data-child-active={hasChildActive}
                          className="data-[child-active=true]:bg-sidebar-accent/60 data-[child-active=true]:text-sidebar-accent-foreground"
                        >
                          <area.icon />
                          <span>{area.label}</span>
                          <ChevronRight className="ml-auto size-4 shrink-0 transition-transform duration-200 group-data-[state=open]/menu-item:rotate-90" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {area.procesos.map((proceso) => {
                            const href = procesoHref(area.slug, proceso.slug);
                            const active = pathname === href;
                            return (
                              <SidebarMenuSubItem key={proceso.slug}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={active}
                                  size="sm"
                                >
                                  <Link href={href} transitionTypes={["nav-forward"]}>
                                    {proceso.flagCode ? (
                                      <FlagIcon
                                        code={proceso.flagCode}
                                        title={proceso.label}
                                        className="size-4 shrink-0 rounded-[2px]"
                                      />
                                    ) : (
                                      <proceso.icon />
                                    )}
                                    <span>{proceso.label}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="rounded-md border border-white/15 bg-white/10 p-2 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0">
          <div
            className="flex items-center gap-2 group-data-[collapsible=icon]:justify-center"
            aria-label={`Sesión activa: ${user.name}`}
          >
            <Avatar className="size-7">
              <AvatarFallback className="text-[11px]">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-xs font-medium text-sidebar-foreground">
                {user.name}
              </span>
              <span className="truncate text-[11px] text-sidebar-foreground/70">
                {user.email || "Toolbox · v0.1"}
              </span>
            </div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
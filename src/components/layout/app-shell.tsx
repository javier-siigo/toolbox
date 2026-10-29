"use client";

import type { CSSProperties } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Permisos } from "@/lib/auth/permisos-shared";

import { AppSidebar } from "./app-sidebar";
import { Topbar } from "./topbar";

interface AppShellProps {
  user: { name: string; email: string };
  permisos: Permisos;
  children: React.ReactNode;
}

export function AppShell({ user, permisos, children }: AppShellProps) {
  const sidebarStyle = { "--sidebar-width": "16.5rem" } as CSSProperties;
  return (
    <TooltipProvider delayDuration={150}>
      <SidebarProvider style={sidebarStyle}>
        <AppSidebar user={user} permisos={permisos} />
        {/* min-w-0: una tabla ancha hace scroll dentro de su contenedor en vez de
            ensanchar toda la página. */}
        <SidebarInset className="min-w-0">
          <Topbar user={user} permisos={permisos} />
          <div className="flex flex-1 flex-col">
            <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
              {children}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
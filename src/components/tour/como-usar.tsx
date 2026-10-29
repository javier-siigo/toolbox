"use client";

import "driver.js/dist/driver.css";

import { useEffect, useRef } from "react";
import type { Driver, DriveStep, Side } from "driver.js";
import { CircleHelp } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Un paso del recorrido. Sin `target` el popover sale centrado (intro o cierre). */
export interface TourStep {
  /** Valor de `data-tour` del elemento a resaltar. */
  target?: string;
  title: string;
  description: string;
  side?: Side;
}

// Ícono X de lucide: el botón de cerrar de driver.js es DOM puro, no React.
const X_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

function selector(target: string) {
  return `[data-tour="${target}"]`;
}

/**
 * Botón "¿Cómo usar?" que recorre la interfaz de un proceso con driver.js.
 * El popover se pinta con los tokens del portal (`.toolbox-tour` en globals.css)
 * y los botones con las variantes de `Button`.
 */
export function ComoUsar({ steps, className }: { steps: TourStep[]; className?: string }) {
  const driverRef = useRef<Driver | null>(null);

  useEffect(() => () => driverRef.current?.destroy(), []);

  const iniciar = async () => {
    const { driver } = await import("driver.js");
    // Pasos cuyo elemento no está en pantalla (p. ej. solo para admin) se omiten.
    const visibles: DriveStep[] = steps
      .filter((s) => !s.target || document.querySelector(selector(s.target)))
      .map((s) => ({
        element: s.target ? selector(s.target) : undefined,
        popover: { title: s.title, description: s.description, side: s.side, align: "start" },
      }));

    driverRef.current?.destroy();
    const oscuro = document.documentElement.classList.contains("dark");
    const d = driver({
      steps: visibles,
      popoverClass: "toolbox-tour",
      showProgress: true,
      progressText: "{{current}} de {{total}}",
      nextBtnText: "Siguiente",
      prevBtnText: "Anterior",
      doneBtnText: "Entendido",
      stagePadding: 6,
      stageRadius: 8,
      // En oscuro el slate del claro casi no se distingue del fondo.
      overlayColor: oscuro ? "oklch(0 0 0)" : "oklch(0.205 0.013 256)",
      overlayOpacity: oscuro ? 0.7 : 0.5,
      // Con scroll suave driver.js posiciona el popover antes de terminar de
      // desplazarse y puede tapar el elemento resaltado.
      smoothScroll: false,
      // Solo se mira: un clic accidental no debe cambiar la configuración.
      disableActiveInteraction: true,
      onPopoverRender: (popover) => {
        popover.previousButton.className = cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "driver-popover-prev-btn",
        );
        popover.nextButton.className = cn(
          buttonVariants({ size: "sm" }),
          "driver-popover-next-btn",
        );
        popover.closeButton.className = cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "driver-popover-close-btn",
        );
        // driver.js fija `display: block` en línea; las variantes de Button usan
        // inline-flex. En el primer paso "Anterior" queda deshabilitado: se oculta.
        for (const btn of [popover.previousButton, popover.nextButton]) {
          if (btn.style.display !== "none") btn.style.display = "inline-flex";
        }
        if (popover.previousButton.disabled) popover.previousButton.style.display = "none";
        popover.closeButton.innerHTML = X_ICON;
        popover.closeButton.setAttribute("aria-label", "Cerrar recorrido");
      },
      onDestroyed: () => {
        driverRef.current = null;
      },
    });
    driverRef.current = d;
    d.drive();
  };

  return (
    <Button variant="outline" size="sm" className={className} onClick={() => void iniciar()}>
      <CircleHelp aria-hidden />
      ¿Cómo usar?
    </Button>
  );
}

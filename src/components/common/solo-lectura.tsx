import { Eye } from "lucide-react";

import { cn } from "@/lib/utils";

/** Aviso para usuarios con nivel `ver`: la UI oculta o deshabilita lo que el servidor rechazaría. */
export function SoloLectura({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground",
        className,
      )}
    >
      <Eye className="size-4 shrink-0" aria-hidden />
      {children ?? "Tienes acceso de solo lectura a este proceso."}
    </p>
  );
}

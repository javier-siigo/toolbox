"use client";

import * as React from "react";
import { FileText, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/uploads";

interface DomiciliacionRowProps {
  files: File[];
  /** Valor del `accept` del input (.dom, .txt). */
  accept: string;
  max: number;
  onSelect: (files: File[]) => void;
  onRemove: () => void;
  disabled?: boolean;
}

/**
 * TXT diarios de domiciliación (opcional): se suben junto al extracto y n8n los lee por
 * posiciones en la misma conciliación. Reemplaza el Excel "Domi fórmulas".
 */
export function DomiciliacionRow({
  files,
  accept,
  max,
  onSelect,
  onRemove,
  disabled,
}: DomiciliacionRowProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > 0) onSelect(selected);
    e.target.value = "";
  };

  const total = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div
      data-tour="txt"
      className="flex flex-col gap-1 rounded-md bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="sr-only"
        onChange={onChange}
        disabled={disabled}
        tabIndex={-1}
      />
      <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
        <FileText className="size-3.5 shrink-0" aria-hidden />
        {files.length === 0 ? (
          <>
            <span>¿Tienes los TXT de domiciliación? Se concilian junto con el extracto.</span>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
              className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              Agregar TXT
            </button>
            <span className="text-muted-foreground/80">(opcional, hasta {max})</span>
          </>
        ) : (
          <>
            <span role="status" className="min-w-0 truncate" title={files.map((f) => f.name).join(", ")}>
              {files.length} TXT de domiciliación ·{" "}
              <span className="tabular-nums">{formatBytes(total)}</span>
            </span>
            <div className="ml-auto flex items-center">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={disabled}
                className="mr-1 font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
              >
                Cambiar
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                onClick={onRemove}
                disabled={disabled}
                aria-label="Quitar TXT de domiciliación"
                title="Quitar"
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

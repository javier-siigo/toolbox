"use client";

import * as React from "react";
import { FileSpreadsheet, Loader2, Upload, X } from "lucide-react";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import {
  ACCEPTED_EXTENSIONS_LABEL,
  MAX_FILE_SIZE_LABEL,
  formatBytes,
  type FileSlotState,
} from "@/lib/uploads";
import { cn } from "@/lib/utils";

export {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_EXTENSIONS_WITH_DOTS,
  ACCEPTED_EXTENSIONS_LABEL,
  ACCEPTED_MIME_PREFIXES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  formatBytes,
} from "@/lib/uploads";

export type { FileSlotState } from "@/lib/uploads";

interface FileDropZoneProps {
  dragOver: boolean;
  disabled: boolean;
  accept?: string;
  ariaLabel: string;
  hint?: string;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  /** Ajustes de alto/relleno de la superficie que lo usa. */
  className?: string;
}

export function FileDropZone({
  dragOver,
  disabled,
  accept: _accept,
  ariaLabel,
  hint,
  onClick,
  onKeyDown,
  onDragOver,
  onDragLeave,
  onDrop,
  className,
}: FileDropZoneProps) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={ariaLabel}
      onClick={disabled ? undefined : onClick}
      onKeyDown={onKeyDown}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        dragOver
          ? "border-primary bg-primary/5"
          : "border-border hover:border-foreground/30 hover:bg-muted/40",
        className,
      )}
    >
      <div
        aria-hidden
        className="flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground"
      >
        <Upload className="size-4" />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground">
          Arrastra tu archivo aquí
        </span>
        <span className="text-xs text-muted-foreground">
          {hint ?? `o haz clic para seleccionarlo · ${ACCEPTED_EXTENSIONS_LABEL} (máx. ${MAX_FILE_SIZE_LABEL})`}
        </span>
      </div>
    </div>
  );
}

interface SelectedFileChipProps {
  file: File;
  state: FileSlotState;
  onRemove?: () => void;
  onSubmit?: () => void;
  onRetry?: () => void;
  submitLabel?: string;
  retryLabel?: string;
  removeAriaLabel?: string;
  showSubmit?: boolean;
  showRetry?: boolean;
  busy?: boolean;
}

export function SelectedFileChip({
  file,
  state,
  onRemove,
  onSubmit,
  onRetry,
  submitLabel = "Procesar",
  retryLabel = "Reintentar",
  removeAriaLabel = "Quitar archivo",
  showSubmit = false,
  showRetry = false,
  busy = false,
}: SelectedFileChipProps) {
  const verbLabel = React.useMemo(() => {
    if (state === "uploading") return "subiendo…";
    if (state === "processing") return "procesando…";
    if (state === "done") return "enviado";
    if (state === "error") return "falló";
    return null;
  }, [state]);

  return (
    <Attachment state={state} orientation="horizontal" className="w-full min-w-0">
      <AttachmentMedia>
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <FileSpreadsheet className="size-4" aria-hidden />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{file.name}</AttachmentTitle>
        <AttachmentDescription>
          <span className="font-mono text-sm tabular-nums">
            {formatBytes(file.size)}
          </span>
          {verbLabel && (
            <>
              {" · "}
              <span className="font-medium uppercase tracking-wide">
                {verbLabel}
              </span>
            </>
          )}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        {onRemove && (
          <AttachmentAction
            variant="ghost"
            size="icon-xs"
            aria-label={removeAriaLabel}
            title={removeAriaLabel}
            onClick={onRemove}
            disabled={busy}
          >
            <X className="size-4" aria-hidden />
          </AttachmentAction>
        )}
        {showSubmit && onSubmit && (
          <Button size="sm" variant="default" onClick={onSubmit}>
            {submitLabel}
          </Button>
        )}
        {showRetry && onRetry && (
          <Button size="sm" variant="default" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
      </AttachmentActions>
    </Attachment>
  );
}

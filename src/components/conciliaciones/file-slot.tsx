"use client";

import * as React from "react";

import {
  ACCEPTED_EXTENSIONS_WITH_DOTS,
  FileDropZone,
  SelectedFileChip,
  type FileSlotState,
} from "@/components/common/file-upload";

interface FileSlotProps {
  file: File | null;
  status: FileSlotState;
  ariaLabel: string;
  hint?: string;
  /** Extensiones aceptadas por el selector; por defecto .xlsx, .xls y .csv. */
  accept?: string;
  onSelect: (file: File) => void;
  onRemove: () => void;
  disabled?: boolean;
  /** Clases extra para la zona de arrastre (alto según la superficie). */
  dropZoneClassName?: string;
}

export function FileSlot({
  file,
  status,
  ariaLabel,
  hint,
  accept = ACCEPTED_EXTENSIONS_WITH_DOTS.join(","),
  onSelect,
  onRemove,
  disabled,
  dropZoneClassName,
}: FileSlotProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const openPicker = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFile = React.useCallback(
    (next: File | null) => {
      if (!next) return;
      onSelect(next);
      if (inputRef.current) inputRef.current.value = "";
    },
    [onSelect],
  );

  const onChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFile(e.target.files?.[0] ?? null);
    },
    [handleFile],
  );

  const onDragOver = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);
  const onDragLeave = React.useCallback(() => setDragOver(false), []);
  const onDrop = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      handleFile(e.dataTransfer.files?.[0] ?? null);
    },
    [handleFile],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPicker();
      }
    },
    [openPicker],
  );

  const busy = disabled || status === "uploading" || status === "processing";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={onChange}
        disabled={busy}
      />
      {!file ? (
        <FileDropZone
          dragOver={dragOver}
          disabled={busy}
          ariaLabel={ariaLabel}
          hint={hint}
          onClick={openPicker}
          onKeyDown={onKeyDown}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={dropZoneClassName}
        />
      ) : (
        <SelectedFileChip
          file={file}
          state={status}
          busy={busy}
          onRemove={onRemove}
          removeAriaLabel="Quitar archivo"
        />
      )}
    </div>
  );
}

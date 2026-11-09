"use client";

import * as React from "react";
import { Check, Download, FileText, Loader2, RotateCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  FORMATO_LABEL,
  acceptDeFormato,
  type ArchivoTxtConError,
  type FormatoConversion,
} from "@/lib/conciliaciones/particularidades";

export interface ResumenTxt {
  archivos?: number;
  registros?: number;
  totalNeto?: number;
  alertas?: number;
  errores?: number;
  duplicadosOmitidos?: number;
  fueraPeriodo?: number;
}

export interface TxtConversion {
  status: "idle" | "processing" | "done" | "error";
  excel?: File;
  resumen?: ResumenTxt;
  /** En éxito: TXT que n8n no pudo leer. En error: el detalle por archivo. */
  archivosConError?: ArchivoTxtConError[];
  error?: string;
}

interface TxtConvertRowProps {
  formato: FormatoConversion;
  txtFiles: File[];
  conversion: TxtConversion;
  /** El Excel convertido sigue siendo el extracto seleccionado. */
  enUsoComoExtracto: boolean;
  onSelect: (files: File[]) => void;
  onRemove: () => void;
  onRetry: () => void;
  onDownload: () => void;
  onUsarComoExtracto: () => void;
  disabled?: boolean;
}

const MXN = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

function archivosLabel(n: number, formato: FormatoConversion): string {
  return `${n} ${FORMATO_LABEL[formato]}`;
}

/** Paso 1 opcional y discreto: consolida varios archivos del banco en un solo Excel. */
export function TxtConvertRow({
  formato,
  txtFiles,
  conversion,
  enUsoComoExtracto,
  onSelect,
  onRemove,
  onRetry,
  onDownload,
  onUsarComoExtracto,
  disabled,
}: TxtConvertRowProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) onSelect(files);
    e.target.value = "";
  };

  const iconButton = "size-7 text-muted-foreground hover:text-foreground";
  const archivosConError = conversion.archivosConError ?? [];

  const removeButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={iconButton}
      onClick={onRemove}
      disabled={disabled}
      aria-label={`Quitar ${FORMATO_LABEL[formato]}`}
      title="Quitar"
    >
      <X className="size-3.5" aria-hidden />
    </Button>
  );

  return (
    <div
      data-tour="txt"
      className="flex flex-col gap-1 rounded-md bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <input
        ref={inputRef}
        type="file"
        accept={acceptDeFormato(formato)}
        multiple
        className="sr-only"
        onChange={onChange}
        disabled={disabled}
        tabIndex={-1}
      />

      <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
        {conversion.status === "idle" && (
          <>
            <FileText className="size-3.5 shrink-0" aria-hidden />
            <span>
              {formato === "txt"
                ? "¿El extracto viene en uno o varios .txt?"
                : "¿Tienes varios reportes diarios en Excel?"}
            </span>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
              className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              {formato === "txt" ? "Convertir a Excel" : "Unificar en un Excel"}
            </button>
          </>
        )}

        {conversion.status === "processing" && (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
            <span role="status" className="min-w-0 truncate">
              Paso 1 de 2 · {formato === "txt" ? "Convirtiendo" : "Unificando"}{" "}
              {archivosLabel(txtFiles.length, formato)}…
            </span>
          </>
        )}

        {conversion.status === "error" && (
          <>
            <FileText className="size-3.5 shrink-0 text-destructive" aria-hidden />
            <span role="alert" className="min-w-0 text-destructive">
              Falló el paso 1 ({formato === "txt" ? "conversión de TXT" : "unificación de Excel"}):{" "}
              {conversion.error}
            </span>
            <div className="ml-auto flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={iconButton}
                onClick={onRetry}
                disabled={disabled}
                aria-label="Reintentar conversión"
                title="Reintentar"
              >
                <RotateCw className="size-3.5" aria-hidden />
              </Button>
              {removeButton}
            </div>
          </>
        )}

        {conversion.status === "done" && conversion.excel && (
          <>
            <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
            <span role="status" className="min-w-0">
              {archivosLabel(conversion.resumen?.archivos ?? txtFiles.length, formato)}{" "}
              {formato === "txt" ? "convertidos" : "unificados"}
              {enUsoComoExtracto ? " y cargados como extracto" : ""}
              <ResumenBreve resumen={conversion.resumen} />
            </span>
            <div className="ml-auto flex items-center">
              {!enUsoComoExtracto && (
                <button
                  type="button"
                  onClick={onUsarComoExtracto}
                  disabled={disabled}
                  className="mr-1 font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
                >
                  Usar como extracto
                </button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={iconButton}
                onClick={onDownload}
                aria-label={`Descargar ${conversion.excel.name}`}
                title="Descargar Excel"
              >
                <Download className="size-3.5" aria-hidden />
              </Button>
              {removeButton}
            </div>
          </>
        )}
      </div>

      {archivosConError.length > 0 && (
        <ul className="flex flex-col gap-0.5 pb-1 pl-5.5">
          {archivosConError.map((a, i) => (
            <li key={`${a.archivo}-${i}`} className="text-destructive">
              <span className="font-medium">{a.archivo}</span>: {a.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResumenBreve({ resumen }: { resumen?: ResumenTxt }) {
  if (!resumen) return null;
  const avisos = [
    { label: "alertas", value: resumen.alertas },
    { label: "errores", value: resumen.errores },
  ].filter((a) => a.value !== undefined && a.value > 0);

  return (
    <>
      {resumen.registros !== undefined && (
        <>
          {" · "}
          <span className="tabular-nums">{resumen.registros} registros</span>
        </>
      )}
      {resumen.totalNeto !== undefined && (
        <>
          {" · "}
          <span className="tabular-nums">{MXN.format(resumen.totalNeto)}</span>
        </>
      )}
      {resumen.duplicadosOmitidos !== undefined && resumen.duplicadosOmitidos > 0 && (
        <>
          {" · "}
          <span className="tabular-nums">
            {resumen.duplicadosOmitidos} duplicados omitidos
          </span>
        </>
      )}
      {resumen.fueraPeriodo !== undefined && resumen.fueraPeriodo > 0 && (
        <>
          {" · "}
          <span className="tabular-nums">
            {resumen.fueraPeriodo} fuera del periodo omitidos
          </span>
        </>
      )}
      {avisos.map((a) => (
        <React.Fragment key={a.label}>
          {" · "}
          <span className="font-medium tabular-nums text-destructive">
            {a.value} {a.label}
          </span>
        </React.Fragment>
      ))}
    </>
  );
}

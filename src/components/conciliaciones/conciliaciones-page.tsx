"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { BankCombobox } from "./bank-combobox";
import { DualUploadCard } from "./dual-upload-card";
import { PeriodoBanco } from "./periodo-banco";
import { tourConciliaciones } from "./tour";
import { TxtConvertRow, type TxtConversion } from "./txt-convert-row";
import { ComoUsar } from "@/components/tour/como-usar";
import { Button } from "@/components/ui/button";
import { SoloLectura } from "@/components/common/solo-lectura";
import {
  FORMATO_LABEL,
  acceptDeConversion,
  MAX_TXT_FILES,
  MAX_TXT_TOTAL_BYTES,
  MAX_TXT_TOTAL_LABEL,
  esArchivoDeConversion,
  getConversion,
  mensajeFormatoInvalido,
  parseArchivosConError,
  requiereConversion,
  type ArchivoTxtConError,
} from "@/lib/conciliaciones/particularidades";
import { PREVIO_INVALID_TYPE_MESSAGE, isXlsxFilename } from "@/lib/uploads";
import type {
  BancoConciliacion,
  ConciliacionRun,
  ConciliacionRunStatus,
  Pais,
} from "./types";

type ErrorCode =
  | "unauthorized"
  | "bad_request"
  | "missing_file"
  | "invalid_type"
  | "file_too_large"
  | "upload_failed"
  | "upload_unauthorized"
  | "storage_unauthorized"
  | "storage_not_found"
  | "upstream_config"
  | "upstream_timeout"
  | "upstream_network"
  | "upstream_status"
  | "upstream_empty"
  | "internal";

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  unauthorized: "Tu sesión expiró. Vuelve a iniciar sesión.",
  bad_request: "Solicitud inválida al servidor.",
  missing_file: "Falta el archivo principal a conciliar.",
  invalid_type: "Tipo de archivo no soportado. Usa .xlsx, .xls o .csv.",
  file_too_large: "El archivo supera el límite de 10 MB.",
  upload_failed: "No se pudo subir el archivo. Intenta de nuevo.",
  upload_unauthorized:
    "No tienes permiso para subir el archivo. Vuelve a iniciar sesión.",
  storage_unauthorized: "No tienes acceso a este archivo.",
  storage_not_found: "El archivo subido ya no está disponible. Súbelo de nuevo.",
  upstream_config: "Falta configurar la URL del flujo de conciliación.",
  upstream_timeout: "El servicio de conciliación no respondió a tiempo.",
  upstream_network: "No se pudo contactar el servicio de conciliación.",
  upstream_status: "El servicio de conciliación devolvió un error.",
  upstream_empty: "El servicio devolvió un archivo vacío.",
  internal: "Error inesperado al conciliar.",
};

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 15 * 60_000;

/** Espera `ms`; se corta con AbortError si se cancela la conciliación. */
function esperar(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abortar = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abortar);
      resolve();
    }, ms);
    if (signal.aborted) abortar();
    else signal.addEventListener("abort", abortar, { once: true });
  });
}

function asErrorCode(value: string | undefined): ErrorCode {
  return value && value in ERROR_MESSAGES ? (value as ErrorCode) : "internal";
}

function parseCountHeader(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function createRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface UploadResult {
  path: string;
}

interface UploadArgs {
  file: File;
  kind: "principal" | "previo";
}

interface ConciliacionesPageClientProps {
  pais: Pais;
  bancos: BancoConciliacion[];
  /** Nivel `ver`: puede revisar bancos pero no ejecutar conciliaciones. */
  soloLectura?: boolean;
}

const PAIS_LABEL: Record<Pais, string> = {
  CO: "Colombia",
  MX: "México",
  UY: "Uruguay",
  CL: "Chile",
  EC: "Ecuador",
};

export function ConciliacionesPageClient({
  pais,
  bancos,
  soloLectura = false,
}: ConciliacionesPageClientProps) {
  const [banco, setBanco] = React.useState<BancoConciliacion | null>(null);
  const [principalFile, setPrincipalFile] = React.useState<File | null>(null);
  const [previoFile, setPrevioFile] = React.useState<File | null>(null);
  const [currentRun, setCurrentRun] = React.useState<ConciliacionRun | null>(null);
  const [txtFiles, setTxtFiles] = React.useState<File[]>([]);
  const [txtConversion, setTxtConversion] = React.useState<TxtConversion>({
    status: "idle",
  });

  const abortRef = React.useRef<AbortController | null>(null);
  const txtAbortRef = React.useRef<AbortController | null>(null);
  const blobUrlsRef = React.useRef<Map<string, string>>(new Map());

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      txtAbortRef.current?.abort();
      for (const url of blobUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      blobUrlsRef.current.clear();
    };
  }, []);

  const handleSelectPrincipal = React.useCallback((file: File) => {
    setPrincipalFile(file);
    setCurrentRun((prev) =>
      prev && (prev.status === "done" || prev.status === "error") ? null : prev,
    );
  }, []);

  const handleSelectPrevio = React.useCallback((file: File) => {
    if (!isXlsxFilename(file.name)) {
      toast.error(PREVIO_INVALID_TYPE_MESSAGE);
      return;
    }
    setPrevioFile(file);
  }, []);

  const handleRemovePrincipal = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPrincipalFile(null);
    setCurrentRun(null);
  }, []);

  const handleRemovePrevio = React.useCallback(() => {
    setPrevioFile(null);
  }, []);

  const resetTxt = React.useCallback(() => {
    txtAbortRef.current?.abort();
    txtAbortRef.current = null;
    setTxtFiles([]);
    setTxtConversion({ status: "idle" });
  }, []);

  const handleClearBanco = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    resetTxt();
    setBanco(null);
    setCurrentRun(null);
  }, [resetTxt]);

  const convertTxt = React.useCallback(
    async (bancoSel: BancoConciliacion, files: File[]) => {
      const config = getConversion(pais, bancoSel.slug);
      if (!config) return;
      const etiqueta = FORMATO_LABEL[config.formato];
      const controller = new AbortController();
      txtAbortRef.current?.abort();
      txtAbortRef.current = controller;
      setTxtConversion({ status: "processing" });

      const failTxt = (message: string, archivosConError: ArchivoTxtConError[] = []) => {
        setTxtConversion({ status: "error", error: message, archivosConError });
        toast.error(`Paso 1 (unificación de ${etiqueta}): ${message}`);
      };

      try {
        const form = new FormData();
        form.append("pais", pais);
        form.append("banco", bancoSel.slug);
        for (const file of files) form.append("files", file, file.name);
        const res = await fetch("/api/conciliaciones/convertir-txt", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });

        if (!res.ok) {
          const payload = (await res.json().catch(() => null)) as
            | { error?: string; code?: string; archivosConError?: unknown }
            | null;
          failTxt(
            payload?.error ?? `No se pudieron unificar los archivos ${etiqueta}. Intenta de nuevo.`,
            parseArchivosConError(payload?.archivosConError),
          );
          return;
        }

        const blob = await res.blob();
        const excel = new File([blob], config.extractoFilename, {
          type:
            blob.type ||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

        const num = (h: string) => parseCountHeader(res.headers.get(h));
        setTxtConversion({
          status: "done",
          excel,
          resumen: {
            archivos: num("x-archivos"),
            registros: num("x-registros"),
            totalNeto: num("x-total-neto"),
            alertas: num("x-alertas"),
            errores: num("x-errores"),
            duplicadosOmitidos: num("x-duplicados-omitidos"),
            fueraPeriodo: num("x-registros-fuera-periodo"),
          },
          archivosConError: parseArchivosConError(res.headers.get("x-archivos-error")),
        });
        // El Excel consolidado es el extracto que se concilia en el paso 2.
        setPrincipalFile(excel);
        setCurrentRun((prev) =>
          prev && (prev.status === "done" || prev.status === "error") ? null : prev,
        );
        toast.success(`Paso 1 listo: ${etiqueta} unificados y cargados como extracto`);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        failTxt((err as Error).message || "No se pudo contactar el servicio de conversión.");
      } finally {
        if (txtAbortRef.current === controller) txtAbortRef.current = null;
      }
    },
    [pais],
  );

  const handleSelectTxt = React.useCallback(
    (files: File[]) => {
      if (!banco) return;
      const config = getConversion(pais, banco.slug);
      if (!config) return;
      const invalido = files.find((f) => !esArchivoDeConversion(f.name, config));
      if (invalido) {
        toast.error(mensajeFormatoInvalido(invalido.name, config));
        return;
      }
      if (files.length > MAX_TXT_FILES) {
        toast.error(
          `Puedes subir hasta ${MAX_TXT_FILES} archivos ${FORMATO_LABEL[config.formato]} a la vez.`,
        );
        return;
      }
      if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TXT_TOTAL_BYTES) {
        toast.error(`Los archivos superan el límite de ${MAX_TXT_TOTAL_LABEL} en total.`);
        return;
      }
      setTxtFiles(files);
      void convertTxt(banco, files);
    },
    [banco, pais, convertTxt],
  );

  const handleRetryTxt = React.useCallback(() => {
    if (banco && txtFiles.length > 0) void convertTxt(banco, txtFiles);
  }, [banco, txtFiles, convertTxt]);

  const handleDownloadTxtExcel = React.useCallback(() => {
    const excel = txtConversion.excel;
    if (!excel) return;
    const url = URL.createObjectURL(excel);
    const a = document.createElement("a");
    a.href = url;
    a.download = excel.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [txtConversion.excel]);

  const handleUsarTxtComoExtracto = React.useCallback(() => {
    if (txtConversion.excel) handleSelectPrincipal(txtConversion.excel);
  }, [txtConversion.excel, handleSelectPrincipal]);

  async function uploadOne(
    args: UploadArgs,
    signal: AbortSignal,
  ): Promise<UploadResult> {
    const presignRes = await fetch("/api/conciliaciones/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pais,
        kind: args.kind,
        filename: args.file.name,
        contentType: args.file.type || "application/octet-stream",
        size: args.file.size,
      }),
      signal,
    });

    if (!presignRes.ok) {
      const payload = (await presignRes.json().catch(() => null)) as
        | { error?: string; code?: string }
        | null;
      const code = asErrorCode(payload?.code);
      throw new Error(payload?.error ?? ERROR_MESSAGES[code]);
    }

    const { url, path } = (await presignRes.json()) as { url: string; path: string };

    const uploadRes = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": args.file.type || "application/octet-stream",
      },
      body: args.file,
      signal,
    });

    if (!uploadRes.ok) {
      const code: ErrorCode =
        uploadRes.status === 401 || uploadRes.status === 403
          ? "upload_unauthorized"
          : "upload_failed";
      throw new Error(ERROR_MESSAGES[code]);
    }

    return { path };
  }

  const runConciliacion = React.useCallback(
    async (bancoSel: BancoConciliacion, principal: File, previo: File | null) => {
      const id = createRunId();
      const baseRun: ConciliacionRun = {
        id,
        status: "uploading",
        banco: bancoSel.slug,
        bancoNombre: bancoSel.nombre,
        principalFilename: principal.name,
        principalSize: principal.size,
        previoFilename: previo?.name,
        previoSize: previo?.size,
        startedAt: Date.now(),
      };
      setCurrentRun(baseRun);

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      const { signal } = controller;

      // Con unificación de archivos la conciliación es el paso 2 de 2.
      const pasoLabel = requiereConversion(pais, bancoSel.slug)
        ? "Paso 2 (conciliación): "
        : "";

      const fail = (message: string) => {
        const failed: ConciliacionRun = {
          ...baseRun,
          status: "error",
          error: message,
          finishedAt: Date.now(),
        };
        setCurrentRun(failed);
        toast.error(`${pasoLabel}${message}`);
      };

      try {
        const principalUpload = await uploadOne(
          { file: principal, kind: "principal" },
          signal,
        );
        let previoUpload: UploadResult | null = null;
        if (previo) {
          previoUpload = await uploadOne({ file: previo, kind: "previo" }, signal);
        }

        setCurrentRun({ ...baseRun, status: "processing" });

        let conciliarRes = await fetch("/api/conciliaciones/conciliar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pais,
            banco: bancoSel.slug,
            bancoNombre: bancoSel.nombre,
            storagePathPrincipal: principalUpload.path,
            originalNamePrincipal: principal.name,
            storagePathPrevio: previoUpload?.path,
            originalNamePrevio: previo?.name,
          }),
          signal,
        });

        // n8n trabaja en segundo plano: el POST devuelve 202 { jobId } y se consulta hasta
        // que el GET deje de responder 202 (Excel listo o error).
        if (conciliarRes.status === 202) {
          const { jobId } = (await conciliarRes.json()) as { jobId: string };
          const limite = Date.now() + POLL_TIMEOUT_MS;
          do {
            if (Date.now() > limite) {
              fail("La conciliación tardó más de 15 minutos. Revisa el flujo en n8n e intenta de nuevo.");
              return;
            }
            await esperar(POLL_INTERVAL_MS, signal);
            conciliarRes = await fetch(
              `/api/conciliaciones/conciliar?pais=${encodeURIComponent(pais)}&job=${jobId}`,
              { cache: "no-store", signal },
            );
          } while (conciliarRes.status === 202);
        }

        if (!conciliarRes.ok) {
          const payload = (await conciliarRes.json().catch(() => null)) as
            | { error?: string; code?: string }
            | null;
          // Sin JSON y con 504 es Vercel cortando la función por tiempo.
          const code =
            !payload && conciliarRes.status === 504
              ? "upstream_timeout"
              : asErrorCode(payload?.code);
          const message = payload?.error ?? ERROR_MESSAGES[code] ?? "Error al conciliar";
          fail(message);
          return;
        }

        const blob = await conciliarRes.blob();
        const contentType =
          conciliarRes.headers.get("content-type")?.split(";")[0]?.trim() ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        const cd = conciliarRes.headers.get("content-disposition") ?? "";
        const filename =
          /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ??
          /filename="?([^";]+)"?/i.exec(cd)?.[1] ??
          `resultado_${bancoSel.slug}.xlsx`;

        const registrosNuevos = parseCountHeader(
          conciliarRes.headers.get("x-registros-nuevos"),
        );
        const registrosExistentes = parseCountHeader(
          conciliarRes.headers.get("x-registros-existentes"),
        );
        const registrosFueraPeriodo = parseCountHeader(
          conciliarRes.headers.get("x-registros-fuera-periodo"),
        );

        const decodedFilename = (() => {
          try {
            return decodeURIComponent(filename);
          } catch {
            return filename;
          }
        })();

        const blobUrl = URL.createObjectURL(blob);
        blobUrlsRef.current.set(id, blobUrl);

        const done: ConciliacionRun = {
          ...baseRun,
          status: "done",
          resultBlob: blob,
          resultContentType: contentType,
          resultFilename: decodedFilename,
          resultSize: blob.size,
          registrosNuevos,
          registrosExistentes,
          registrosFueraPeriodo,
          finishedAt: Date.now(),
        };
        setCurrentRun(done);
        toast.success("Conciliación lista para descargar");
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setCurrentRun(null);
          return;
        }
        fail((err as Error).message || "No se pudo contactar el servicio.");
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [pais],
  );

  const handleSubmit = React.useCallback(() => {
    if (!banco || !principalFile) return;
    if (previoFile && !isXlsxFilename(previoFile.name)) {
      toast.error(PREVIO_INVALID_TYPE_MESSAGE);
      return;
    }
    void runConciliacion(banco, principalFile, previoFile);
  }, [banco, principalFile, previoFile, runConciliacion]);

  const triggerDownload = React.useCallback((run: ConciliacionRun) => {
    const blob = run.resultBlob;
    if (!blob) return;
    const url =
      blobUrlsRef.current.get(run.id) ?? URL.createObjectURL(blob);
    if (!blobUrlsRef.current.has(run.id)) {
      blobUrlsRef.current.set(run.id, url);
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = run.resultFilename ?? `resultado_${run.banco}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const isBusy =
    currentRun?.status === "uploading" || currentRun?.status === "processing";
  const isConvertingTxt = txtConversion.status === "processing";
  const canSubmit = !soloLectura && !!banco && !!principalFile && !isBusy && !isConvertingTxt;
  const conversion = banco ? getConversion(pais, banco.slug) : null;
  const conTxt = conversion !== null;

  const idleFileStatus: ConciliacionRunStatus = "idle";
  const principalStatus: ConciliacionRunStatus =
    currentRun?.status === "done" || currentRun?.status === "error"
      ? idleFileStatus
      : (currentRun?.status ?? idleFileStatus);

  const previoStatus: ConciliacionRunStatus =
    currentRun?.status === "done" || currentRun?.status === "error"
      ? idleFileStatus
      : (currentRun?.status ?? idleFileStatus);

  const tour = React.useMemo(
    () => tourConciliaciones(PAIS_LABEL[pais], { conversion: conversion?.formato }),
    [pais, conversion?.formato],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Conciliación {PAIS_LABEL[pais]}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Conciliación contable para operaciones en {PAIS_LABEL[pais]}. Selecciona el
            banco, carga el extracto bancario del período y, si cuentas con uno,
            el reporte previo.
          </p>
        </div>
        <ComoUsar steps={tour} />
      </header>

      <section
        aria-labelledby="banco-title"
        data-tour="banco"
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-sm"
      >
        <header className="flex flex-col gap-1.5">
          <h2
            id="banco-title"
            className="text-base font-semibold tracking-tight text-foreground"
          >
            Banco a conciliar
          </h2>
          <p className="text-sm text-muted-foreground">
            El banco determina el flujo de n8n que se ejecuta.
          </p>
        </header>
        <div className="@container flex flex-col gap-2">
          <div className="flex flex-col gap-4 @[61rem]:flex-row @[61rem]:items-end @[61rem]:gap-6">
            <div className="flex shrink-0 flex-col gap-1.5">
              <span
                id="banco-label"
                className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Banco
              </span>
              <BankCombobox
                bancos={bancos}
                value={banco}
                onChange={(b) => {
                  handleClearBanco();
                  setBanco(b);
                }}
                disabled={isBusy}
              />
            </div>
            <div className="flex min-w-0 flex-1 border-t border-border pt-4 @[61rem]:border-t-0 @[61rem]:border-l @[61rem]:pt-0 @[61rem]:pl-6">
              {banco ? (
                <PeriodoBanco
                  key={banco.slug}
                  pais={pais}
                  banco={banco}
                  editable={!soloLectura}
                  disabled={isBusy || isConvertingTxt}
                  onSaved={(periodo, periodoCierre) =>
                    setBanco((b) =>
                      b && b.slug === banco.slug ? { ...b, periodo, periodoCierre } : b,
                    )
                  }
                />
              ) : (
                <p className="flex min-h-9 items-center self-end text-sm text-muted-foreground">
                  Elige un banco para ver qué mes se está conciliando.
                </p>
              )}
            </div>
          </div>
          {banco?.descripcion && (
            <p className="text-xs text-muted-foreground">{banco.descripcion}</p>
          )}
        </div>
      </section>

      <DualUploadCard
        principalFile={principalFile}
        principalStatus={principalStatus}
        previoFile={previoFile}
        previoStatus={previoStatus}
        onSelectPrincipal={handleSelectPrincipal}
        onRemovePrincipal={handleRemovePrincipal}
        onSelectPrevio={handleSelectPrevio}
        onRemovePrevio={handleRemovePrevio}
        disabled={isBusy || isConvertingTxt}
        extra={
          conversion && (
            <TxtConvertRow
              formato={conversion.formato}
              accept={acceptDeConversion(conversion)}
              txtFiles={txtFiles}
              conversion={txtConversion}
              enUsoComoExtracto={
                !!txtConversion.excel && principalFile === txtConversion.excel
              }
              onSelect={handleSelectTxt}
              onRemove={resetTxt}
              onRetry={handleRetryTxt}
              onDownload={handleDownloadTxtExcel}
              onUsarComoExtracto={handleUsarTxtComoExtracto}
              disabled={isBusy}
            />
          )
        }
      />

      <div
        className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2"
        data-tour="procesar"
      >
        {currentRun?.status === "done" &&
          (currentRun.registrosNuevos !== undefined ||
            currentRun.registrosExistentes !== undefined) && (
            <p className="mr-auto text-sm text-muted-foreground" role="status">
              Registros nuevos:{" "}
              <span className="font-medium tabular-nums text-foreground">
                {currentRun.registrosNuevos ?? "—"}
              </span>
              {" · "}
              Registros existentes:{" "}
              <span className="font-medium tabular-nums text-foreground">
                {currentRun.registrosExistentes ?? "—"}
              </span>
              {currentRun.registrosFueraPeriodo !== undefined && (
                <>
                  {" · "}
                  Fuera del periodo (omitidos):{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {currentRun.registrosFueraPeriodo}
                  </span>
                </>
              )}
            </p>
          )}
        {soloLectura && (
          <SoloLectura className="mr-auto">
            Tienes acceso de solo lectura: no puedes ejecutar conciliaciones.
          </SoloLectura>
        )}
        {conTxt && currentRun?.status === "error" && (
          <p className="mr-auto text-sm text-destructive" role="alert">
            Falló el paso 2 (conciliación): {currentRun.error}
          </p>
        )}
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {isBusy
            ? conTxt
              ? "Paso 2 de 2 · Conciliando…"
              : "Procesando…"
            : "Procesar conciliación"}
        </Button>
        {currentRun?.status === "done" && (
          <Button
            type="button"
            onClick={() => triggerDownload(currentRun)}
          >
            <Download className="size-4" aria-hidden />
            Descargar
          </Button>
        )}
      </div>
    </div>
  );
}

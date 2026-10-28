"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { BankCombobox } from "./bank-combobox";
import { DualUploadCard } from "./dual-upload-card";
import { tourConciliaciones } from "./tour";
import { TxtConvertRow, type TxtConversion } from "./txt-convert-row";
import { ComoUsar } from "@/components/tour/como-usar";
import { Button } from "@/components/ui/button";
import {
  MAX_TXT_FILES,
  MAX_TXT_TOTAL_BYTES,
  MAX_TXT_TOTAL_LABEL,
  getConversionTxt,
  isTxtFilename,
  parseArchivosConError,
  requiereConversionTxt,
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
  upstream_timeout: "La conciliación tardó más de 5 minutos.",
  upstream_network: "No se pudo contactar el servicio de conciliación.",
  upstream_status: "El servicio de conciliación devolvió un error.",
  upstream_empty: "El servicio devolvió un archivo vacío.",
  internal: "Error inesperado al conciliar.",
};

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
      const config = getConversionTxt(pais, bancoSel.slug);
      if (!config) return;
      const controller = new AbortController();
      txtAbortRef.current?.abort();
      txtAbortRef.current = controller;
      setTxtConversion({ status: "processing" });

      const failTxt = (message: string, archivosConError: ArchivoTxtConError[] = []) => {
        setTxtConversion({ status: "error", error: message, archivosConError });
        toast.error(`Paso 1 (conversión de TXT): ${message}`);
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
            payload?.error ?? "No se pudieron convertir los TXT. Intenta de nuevo.",
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
          },
          archivosConError: parseArchivosConError(res.headers.get("x-archivos-error")),
        });
        // El Excel consolidado es el extracto que se concilia en el paso 2.
        setPrincipalFile(excel);
        setCurrentRun((prev) =>
          prev && (prev.status === "done" || prev.status === "error") ? null : prev,
        );
        toast.success("Paso 1 listo: TXT convertidos y cargados como extracto");
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
      const noTxt = files.find((f) => !isTxtFilename(f.name));
      if (noTxt) {
        toast.error(`${noTxt.name} no es un archivo .txt.`);
        return;
      }
      if (files.length > MAX_TXT_FILES) {
        toast.error(`Puedes subir hasta ${MAX_TXT_FILES} archivos TXT a la vez.`);
        return;
      }
      if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TXT_TOTAL_BYTES) {
        toast.error(`Los TXT superan el límite de ${MAX_TXT_TOTAL_LABEL} en total.`);
        return;
      }
      setTxtFiles(files);
      void convertTxt(banco, files);
    },
    [banco, convertTxt],
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

      // Con conversión de TXT la conciliación es el paso 2 de 2.
      const pasoLabel = requiereConversionTxt(pais, bancoSel.slug)
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

        const conciliarRes = await fetch("/api/conciliaciones/conciliar", {
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
  const canSubmit = !!banco && !!principalFile && !isBusy && !isConvertingTxt;
  const conTxt = !!banco && requiereConversionTxt(pais, banco.slug);

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
    () => tourConciliaciones(PAIS_LABEL[pais], { conTxt }),
    [pais, conTxt],
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
        <div className="flex flex-col gap-2">
          <BankCombobox
            bancos={bancos}
            value={banco}
            onChange={(b) => {
              handleClearBanco();
              setBanco(b);
            }}
            disabled={isBusy}
          />
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
          conTxt && (
            <TxtConvertRow
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
            </p>
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

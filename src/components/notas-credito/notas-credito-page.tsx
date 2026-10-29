"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { SoloLectura } from "@/components/common/solo-lectura";
import { ComoUsar } from "@/components/tour/como-usar";

import { HistoryList } from "./history-list";
import { ResultCard } from "./result-card";
import { TOUR_NOTAS_CREDITO } from "./tour";
import { UploadCard } from "./upload-card";
import type { NotasCreditoRun, NotasCreditoRunStatus } from "./types";

function createRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
  missing_file: "Falta el archivo a conciliar.",
  invalid_type: "Tipo de archivo no soportado. Usa .xlsx, .xls o .csv.",
  file_too_large: "El archivo supera el límite de 10 MB.",
  upload_failed: "No se pudo subir el archivo. Intenta de nuevo.",
  upload_unauthorized:
    "No tienes permiso para subir el archivo. Vuelve a iniciar sesión.",
  storage_unauthorized: "No tienes acceso a este archivo.",
  storage_not_found: "El archivo subido ya no está disponible. Súbelo de nuevo.",
  upstream_config: "Falta configurar la URL del flujo de conciliación.",
  upstream_timeout: "La conciliación tardó demasiado.",
  upstream_network: "No se pudo contactar el servicio de conciliación.",
  upstream_status: "El servicio de conciliación devolvió un error.",
  upstream_empty: "El servicio devolvió un archivo vacío.",
  internal: "Error inesperado al conciliar.",
};

function asErrorCode(value: string | undefined): ErrorCode {
  return value && value in ERROR_MESSAGES ? (value as ErrorCode) : "internal";
}

/** `soloLectura` (nivel `ver`): no puede subir ni ejecutar el flujo. */
export function NotasCreditoPageClient({ soloLectura = false }: { soloLectura?: boolean }) {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [currentRun, setCurrentRun] = useState<NotasCreditoRun | null>(null);
  const [history, setHistory] = useState<NotasCreditoRun[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const blobUrlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      for (const url of blobUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      blobUrlsRef.current.clear();
    };
  }, []);

  const handleSelect = useCallback(
    (file: File) => {
      setPendingFile(file);
      setCurrentRun((prev) =>
        prev && (prev.status === "done" || prev.status === "error")
          ? null
          : prev,
      );
    },
    [],
  );

  const handleRemove = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPendingFile(null);
    setCurrentRun(null);
  }, []);

  const finalizeRun = useCallback(
    (run: NotasCreditoRun) => {
      setHistory((prev) => [run, ...prev].slice(0, 10));
      setCurrentRun(run);
    },
    [],
  );

  const runConciliacion = useCallback(
    async (file: File) => {
      const id = createRunId();
      const baseRun: NotasCreditoRun = {
        id,
        status: "uploading",
        sourceFilename: file.name,
        sourceSize: file.size,
        startedAt: Date.now(),
      };
      setCurrentRun(baseRun);

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      const { signal } = controller;

      const fail = (message: string) => {
        const failed: NotasCreditoRun = {
          ...baseRun,
          status: "error",
          error: message,
          finishedAt: Date.now(),
        };
        finalizeRun(failed);
        toast.error(message);
      };

      try {
        const presignRes = await fetch("/api/notas-credito/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          }),
          signal,
        });

        if (!presignRes.ok) {
          const payload = (await presignRes.json().catch(() => null)) as
            | { error?: string; code?: string }
            | null;
          const code = asErrorCode(payload?.code);
          const message =
            payload?.error ?? ERROR_MESSAGES[code] ?? "Error al preparar la subida";
          fail(message);
          return;
        }

        const { url, path } = (await presignRes.json()) as {
          url: string;
          path: string;
        };

        const uploadRes = await fetch(url, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
          signal,
        });

        if (!uploadRes.ok) {
          const code: keyof typeof ERROR_MESSAGES =
            uploadRes.status === 401 || uploadRes.status === 403
              ? "upload_unauthorized"
              : "upload_failed";
          fail(ERROR_MESSAGES[code]);
          return;
        }

        setCurrentRun({ ...baseRun, status: "processing" });

        const conciliarRes = await fetch("/api/notas-credito/conciliar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storagePath: path, originalName: file.name }),
          signal,
        });

        if (!conciliarRes.ok) {
          const payload = (await conciliarRes.json().catch(() => null)) as
            | { error?: string; code?: string }
            | null;
          const code = asErrorCode(payload?.code);
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
          "resultado_netsuite.xlsx";

        const decodedFilename = (() => {
          try {
            return decodeURIComponent(filename);
          } catch {
            return filename;
          }
        })();

        const blobUrl = URL.createObjectURL(blob);
        blobUrlsRef.current.set(id, blobUrl);

        const done: NotasCreditoRun = {
          ...baseRun,
          status: "done",
          resultBlob: blob,
          resultContentType: contentType,
          resultFilename: decodedFilename,
          resultSize: blob.size,
          finishedAt: Date.now(),
        };
        finalizeRun(done);
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
    [finalizeRun],
  );

  const handleSubmit = useCallback(() => {
    if (!pendingFile) return;
    void runConciliacion(pendingFile);
  }, [pendingFile, runConciliacion]);

  const handleRetry = useCallback(() => {
    if (!currentRun) return;
    if (!pendingFile) {
      setCurrentRun(null);
      return;
    }
    void runConciliacion(pendingFile);
  }, [currentRun, pendingFile, runConciliacion]);

  const triggerDownload = useCallback((run: NotasCreditoRun) => {
    const blob = run.resultBlob;
    if (!blob) return;
    const url =
      blobUrlsRef.current.get(run.id) ?? URL.createObjectURL(blob);
    if (!blobUrlsRef.current.has(run.id)) {
      blobUrlsRef.current.set(run.id, url);
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = run.resultFilename ?? "resultado_netsuite.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);

  const status: NotasCreditoRunStatus = currentRun?.status ?? "idle";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Notas crédito
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Conciliación de notas crédito contra NetSuite.
          </p>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Sube el archivo{" "}
            <span className="font-mono">INFORME</span>
            , ejecuta el flujo y descarga el resultado con las columnas de
            duplicados resueltas.
          </p>
        </div>
        <ComoUsar steps={TOUR_NOTAS_CREDITO} />
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {soloLectura ? (
          <SoloLectura className="self-start">
            Tienes acceso de solo lectura: no puedes ejecutar la conciliación de notas crédito.
          </SoloLectura>
        ) : (
          <UploadCard
            status={status === "idle" && pendingFile ? "idle" : status}
            file={pendingFile}
            onSelect={handleSelect}
            onSubmit={handleSubmit}
            onRemove={handleRemove}
            onRetry={handleRetry}
          />
        )}
        <ResultCard
          run={currentRun}
          onDownload={triggerDownload}
          onRetry={handleRetry}
        />
      </div>

      <HistoryList runs={history} onDownload={triggerDownload} />
    </div>
  );
}

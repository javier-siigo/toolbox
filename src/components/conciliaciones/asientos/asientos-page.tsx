"use client";

import * as React from "react";
import { CloudDownload, Download, FileSpreadsheet, Scale, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { SoloLectura } from "@/components/common/solo-lectura";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ASIENTOS_EXTENSIONES,
  BALANCE_EXTENSIONES,
  MAX_ASIENTOS_BYTES,
  MAX_ASIENTOS_LABEL,
  MAX_BALANCE_BYTES,
  MAX_BALANCE_LABEL,
  PERIODO_RE,
  extensionAceptada,
  type FuenteAsientos,
  type ResumenAsientos,
  type Subsidiaria,
} from "@/lib/conciliaciones/asientos-shared";
import { cn } from "@/lib/utils";

import { FileSlot } from "../file-slot";
import type { ConciliacionRunStatus } from "../types";

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 15 * 60_000;
const SIIGO_SAS = "SIIGO S.A.S";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** Mes anterior al actual: es el que normalmente se cierra y se audita. */
function mesAnterior(): string {
  const hoy = new Date();
  const d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nombrePeriodo(periodo: string): string {
  const [y, m] = periodo.split("-");
  const mes = MESES[Number(m) - 1];
  return mes ? `${mes} ${y}` : periodo;
}

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

const fmtEntero = new Intl.NumberFormat("es-CO");
const fmtPesos = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Resultado {
  blob: Blob;
  filename: string;
  resumen: ResumenAsientos | null;
}

interface AsientosPageClientProps {
  subsidiarias: Subsidiaria[];
  /** NetSuite no respondió al cargar la página: solo queda la opción de archivo. */
  errorSubsidiarias: string | null;
  soloLectura?: boolean;
}

export function AsientosPageClient({ subsidiarias, errorSubsidiarias, soloLectura = false }: AsientosPageClientProps) {
  const [periodo, setPeriodo] = React.useState(mesAnterior);
  const [subsidiariaId, setSubsidiariaId] = React.useState(
    () => subsidiarias.find((s) => s.nombre === SIIGO_SAS)?.id ?? "",
  );
  const [fuente, setFuente] = React.useState<FuenteAsientos>(errorSubsidiarias ? "archivo" : "netsuite");
  const [balance, setBalance] = React.useState<File | null>(null);
  const [asientos, setAsientos] = React.useState<File | null>(null);
  const [status, setStatus] = React.useState<ConciliacionRunStatus>("idle");
  const [resultado, setResultado] = React.useState<Resultado | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const busy = status === "uploading" || status === "processing";
  const periodoValido = PERIODO_RE.test(periodo);
  const subsidiaria = subsidiarias.find((s) => s.id === subsidiariaId) ?? null;
  const faltante = !periodoValido
    ? "Elige el mes a conciliar."
    : !balance
      ? "Sube el balance del periodo."
      : fuente === "netsuite" && !subsidiaria
        ? "Elige la subsidiaria del balance."
        : fuente === "archivo" && !asientos
          ? "Sube el archivo de asientos."
          : null;
  const canSubmit = !soloLectura && !busy && faltante === null;

  /** Cualquier cambio de entrada invalida el resultado anterior. */
  const limpiarResultado = React.useCallback(() => {
    setResultado(null);
    setError(null);
    setStatus((s) => (s === "done" || s === "error" ? "idle" : s));
  }, []);

  const cancelar = React.useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  function elegirArchivo(
    file: File,
    extensiones: readonly string[],
    max: number,
    maxLabel: string,
    etiqueta: string,
    set: (f: File) => void,
  ) {
    if (!extensionAceptada(file.name, extensiones)) {
      toast.error(`${etiqueta} debe ser ${extensiones.map((e) => "." + e).join(" o ")}.`);
      return;
    }
    if (file.size > max) {
      toast.error(
        fuente === "archivo" && etiqueta === "El archivo de asientos"
          ? `${etiqueta} supera ${maxLabel}. Para un mes completo usa “Consultar NetSuite”.`
          : `${etiqueta} supera el límite de ${maxLabel}.`,
      );
      return;
    }
    set(file);
    limpiarResultado();
  }

  async function subir(file: File, kind: "balance" | "asientos", signal: AbortSignal): Promise<string> {
    const res = await fetch("/api/conciliaciones/asientos/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, filename: file.name, size: file.size }),
      signal,
    });
    const payload = (await res.json().catch(() => null)) as { url?: string; path?: string; error?: string } | null;
    if (!res.ok || !payload?.url || !payload.path) {
      throw new Error(payload?.error ?? "No se pudo preparar la subida. Intenta de nuevo.");
    }
    const put = await fetch(payload.url, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
      signal,
    });
    if (!put.ok) throw new Error("No se pudo subir el archivo. Intenta de nuevo.");
    return payload.path;
  }

  async function procesar() {
    if (!canSubmit || !balance) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const { signal } = controller;
    setResultado(null);
    setError(null);
    setStatus("uploading");

    const fallar = (message: string) => {
      setStatus("error");
      setError(message);
      toast.error(message);
    };

    try {
      const balancePath = await subir(balance, "balance", signal);
      const asientosPath = fuente === "archivo" && asientos ? await subir(asientos, "asientos", signal) : null;
      setStatus("processing");

      let res = await fetch("/api/conciliaciones/asientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fuente,
          periodo,
          subsidiariaId: subsidiaria?.id ?? "",
          balance: { storagePath: balancePath, originalName: balance.name },
          ...(asientosPath && asientos
            ? { asientos: { storagePath: asientosPath, originalName: asientos.name } }
            : {}),
        }),
        signal,
      });

      if (res.status === 202) {
        const { jobId } = (await res.json()) as { jobId: string };
        const limite = Date.now() + POLL_TIMEOUT_MS;
        do {
          if (Date.now() > limite) {
            fallar("La conciliación tardó más de 15 minutos. Revisa el flujo en n8n e intenta de nuevo.");
            return;
          }
          await esperar(POLL_INTERVAL_MS, signal);
          res = await fetch(`/api/conciliaciones/asientos?job=${jobId}`, { cache: "no-store", signal });
        } while (res.status === 202);
      }

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        fallar(payload?.error ?? "El servicio de conciliación devolvió un error.");
        return;
      }

      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") ?? "";
      const crudo =
        /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? "conciliacion_asientos.xlsx";
      let filename = crudo;
      try {
        filename = decodeURIComponent(crudo);
      } catch {
        // nombre sin codificar
      }
      let resumen: ResumenAsientos | null = null;
      try {
        const h = res.headers.get("x-resumen");
        resumen = h ? (JSON.parse(decodeURIComponent(h)) as ResumenAsientos) : null;
      } catch {
        resumen = null;
      }
      setResultado({ blob, filename, resumen });
      setStatus("done");
      toast.success("Conciliación lista para descargar");
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
        return;
      }
      fallar((err as Error).message || "No se pudo contactar el servicio.");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function descargar() {
    if (!resultado) return;
    const url = URL.createObjectURL(resultado.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = resultado.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const slotStatus: ConciliacionRunStatus = busy ? status : "idle";
  const r = resultado?.resumen;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex min-w-0 flex-col gap-2">
        <h1 className="text-base font-semibold tracking-tight text-foreground">Conciliación de asientos de diario</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cruza, cuenta por cuenta, los débitos y créditos de los asientos del periodo contra el balance. El Excel
          resultante trae el resumen, el detalle de lo que cruzó y lo que no, y un comparativo con la explicación de
          cada diferencia.
        </p>
      </header>

      <section
        aria-labelledby="asientos-parametros"
        className="flex flex-col gap-5 rounded-lg border border-border bg-card p-5 shadow-sm"
      >
        <header className="flex flex-col gap-1.5">
          <h2 id="asientos-parametros" className="text-base font-semibold tracking-tight text-foreground">
            Periodo y origen de los asientos
          </h2>
          <p className="text-sm text-muted-foreground">
            El periodo y la subsidiaria deben ser los mismos del balance que vas a subir.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[13.5rem_minmax(0,20rem)]">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="asientos-periodo"
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Periodo
            </label>
            <Input
              id="asientos-periodo"
              type="month"
              value={periodo}
              onChange={(e) => {
                setPeriodo(e.target.value);
                limpiarResultado();
              }}
              disabled={busy}
              aria-invalid={!periodoValido}
              className="font-mono tabular-nums"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span
              id="asientos-subsidiaria"
              className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Subsidiaria
            </span>
            <Select
              value={subsidiariaId}
              onValueChange={(v) => {
                setSubsidiariaId(v);
                limpiarResultado();
              }}
              disabled={busy || subsidiarias.length === 0}
            >
              <SelectTrigger aria-labelledby="asientos-subsidiaria" className="w-full">
                <SelectValue placeholder={subsidiarias.length ? "Elige la subsidiaria" : "No disponible"} />
              </SelectTrigger>
              <SelectContent>
                {subsidiarias.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.nombre}
                    {s.pais && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{s.pais}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2" disabled={busy}>
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Asientos de diario
          </legend>
          <div role="radiogroup" aria-label="Origen de los asientos" className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <OpcionFuente
              activa={fuente === "netsuite"}
              deshabilitada={!!errorSubsidiarias}
              icono={<CloudDownload className="size-4" aria-hidden />}
              titulo="Consultar NetSuite"
              detalle={
                errorSubsidiarias
                  ? `No disponible: ${errorSubsidiarias}`
                  : "n8n trae todas las líneas contabilizadas del periodo contable y la subsidiaria. Un mes completo tarda cerca de un minuto."
              }
              onSelect={() => {
                setFuente("netsuite");
                limpiarResultado();
              }}
            />
            <OpcionFuente
              activa={fuente === "archivo"}
              icono={<FileSpreadsheet className="size-4" aria-hidden />}
              titulo="Subir archivo"
              detalle={`El Excel de Auditoría Asientos de Diario o un CSV con número de cuenta, débito y crédito. Hasta ${MAX_ASIENTOS_LABEL}.`}
              onSelect={() => {
                setFuente("archivo");
                limpiarResultado();
              }}
            />
          </div>
        </fieldset>
      </section>

      <section
        aria-labelledby="asientos-archivos"
        className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-sm"
      >
        <header className="flex flex-col gap-1.5">
          <h2 id="asientos-archivos" className="text-base font-semibold tracking-tight text-foreground">
            Archivos
          </h2>
          <p className="text-sm text-muted-foreground">
            El balance necesita una fila de encabezado con columnas de débito y crédito, y una fila por cuenta.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Slot titulo="Balance del periodo" icono={<Scale className="size-4" aria-hidden />} requerido>
            <FileSlot
              file={balance}
              status={slotStatus}
              ariaLabel="Seleccionar balance"
              hint={`o haz clic para seleccionarlo · .xlsx o .csv (máx. ${MAX_BALANCE_LABEL})`}
              accept={BALANCE_EXTENSIONES.map((e) => "." + e).join(",")}
              onSelect={(f) => elegirArchivo(f, BALANCE_EXTENSIONES, MAX_BALANCE_BYTES, MAX_BALANCE_LABEL, "El balance", setBalance)}
              onRemove={() => {
                cancelar();
                setBalance(null);
                limpiarResultado();
              }}
              disabled={busy}
            />
          </Slot>
          {fuente === "archivo" ? (
            <Slot titulo="Asientos de diario" icono={<FileSpreadsheet className="size-4" aria-hidden />} requerido>
              <FileSlot
                file={asientos}
                status={slotStatus}
                ariaLabel="Seleccionar archivo de asientos"
                hint={`o haz clic para seleccionarlo · .xlsx o .csv (máx. ${MAX_ASIENTOS_LABEL})`}
                accept={ASIENTOS_EXTENSIONES.map((e) => "." + e).join(",")}
                onSelect={(f) =>
                  elegirArchivo(f, ASIENTOS_EXTENSIONES, MAX_ASIENTOS_BYTES, MAX_ASIENTOS_LABEL, "El archivo de asientos", setAsientos)
                }
                onRemove={() => {
                  cancelar();
                  setAsientos(null);
                  limpiarResultado();
                }}
                disabled={busy}
              />
            </Slot>
          ) : (
            <Slot titulo="Asientos de diario" icono={<CloudDownload className="size-4" aria-hidden />}>
              <div className="flex min-h-28 flex-col justify-center gap-1 rounded-md border border-dashed border-border bg-muted/40 px-4 py-3 text-sm">
                <p className="font-medium text-foreground">Se consultan en NetSuite</p>
                <p className="text-muted-foreground">
                  Periodo contable <span className="text-foreground">{periodoValido ? nombrePeriodo(periodo) : "—"}</span>
                  {" · "}
                  {subsidiaria ? <span className="text-foreground">{subsidiaria.nombre}</span> : "sin subsidiaria"}
                </p>
              </div>
            </Slot>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-3">
        <div className="mr-auto min-w-0" role="status" aria-live="polite">
          {soloLectura ? (
            <SoloLectura>Tienes acceso de solo lectura: no puedes ejecutar conciliaciones.</SoloLectura>
          ) : status === "uploading" ? (
            <p className="text-sm text-muted-foreground">Subiendo archivos…</p>
          ) : status === "processing" ? (
            <p className="text-sm text-muted-foreground">
              {fuente === "netsuite"
                ? "n8n está consultando NetSuite y cruzando por cuenta. Puede tardar un minuto."
                : "n8n está leyendo los asientos y cruzando por cuenta."}
            </p>
          ) : status === "error" && error ? (
            <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              {error}
            </p>
          ) : status === "done" && r ? (
            <ResumenLinea resumen={r} />
          ) : faltante && (balance || asientos) ? (
            <p className="text-sm text-muted-foreground">{faltante}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant={status === "done" ? "outline" : "default"}
          onClick={procesar}
          disabled={!canSubmit}
        >
          {status === "uploading" ? "Subiendo…" : status === "processing" ? "Conciliando…" : "Conciliar asientos"}
        </Button>
        {status === "done" && resultado && (
          <Button type="button" onClick={descargar}>
            <Download className="size-4" aria-hidden />
            Descargar
          </Button>
        )}
      </div>
    </div>
  );
}

function OpcionFuente({
  activa,
  deshabilitada,
  icono,
  titulo,
  detalle,
  onSelect,
}: {
  activa: boolean;
  deshabilitada?: boolean;
  icono: React.ReactNode;
  titulo: string;
  detalle: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activa}
      disabled={deshabilitada}
      onClick={onSelect}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-md border px-4 py-3 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        activa ? "border-primary/40 bg-primary/5" : "border-border bg-background hover:bg-muted/40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          activa ? "border-primary" : "border-input",
        )}
      >
        {activa && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <span className="text-muted-foreground">{icono}</span>
          {titulo}
        </span>
        <span className="text-xs text-muted-foreground">{detalle}</span>
      </span>
    </button>
  );
}

function Slot({
  titulo,
  icono,
  requerido,
  children,
}: {
  titulo: string;
  icono: React.ReactNode;
  requerido?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center text-muted-foreground">{icono}</span>
          <span className="text-sm font-medium text-foreground">{titulo}</span>
        </div>
        {requerido && (
          <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/5 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-primary">
            Obligatorio
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ResumenLinea({ resumen }: { resumen: ResumenAsientos }) {
  const n = (v: number | null) => (v === null ? "—" : fmtEntero.format(v));
  const dif = (v: number | null) => (v === null ? "—" : `$${fmtPesos.format(v)}`);
  const hayDif = (resumen.noCruzan ?? 0) > 0;
  return (
    <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
      <Cifra etiqueta="Cuentas" valor={n(resumen.cuentas)} />
      <Cifra etiqueta="Cruzan" valor={n((resumen.cruzan ?? 0) + (resumen.redondeo ?? 0))} tono="ok" />
      <Cifra etiqueta="No cruzan" valor={n(resumen.noCruzan)} tono={hayDif ? "bad" : undefined} />
      {hayDif && (
        <>
          <Cifra etiqueta="Dif. débito" valor={dif(resumen.difDebito)} />
          <Cifra etiqueta="Dif. crédito" valor={dif(resumen.difCredito)} />
        </>
      )}
    </dl>
  );
}

function Cifra({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: "ok" | "bad" }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{etiqueta}</dt>
      <dd
        className={cn(
          "font-mono font-medium tabular-nums",
          tono === "ok"
            ? "text-emerald-700 dark:text-emerald-400"
            : tono === "bad"
              ? "text-amber-700 dark:text-amber-400"
              : "text-foreground",
        )}
      >
        {valor}
      </dd>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, FileText, Loader2, Paperclip, Pencil, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { periodoLabel } from "@/lib/comisiones/calculo";
import {
  eliminarRecibo,
  getHistorialRecibo,
  quitarSoporte,
  urlSoporte,
} from "@/lib/servicios-publicos/actions";
import { alertaDe } from "@/lib/servicios-publicos/alertas";
import {
  ESTADO_CORTO,
  SOPORTE_ACCEPT,
  esEstado,
  formatFecha,
  formatValor,
  type EventoHistorial,
  type Recibo,
} from "@/lib/servicios-publicos/schema";
import { cn } from "@/lib/utils";

import { AlertaIndicador, SectionLabel, TONO_ALERTA } from "./bits";
import { SiguientePaso, type AccionRecibo } from "./siguiente-paso";
import { subirSoporte } from "./subir-soporte";

export function ReciboDetalle({
  recibo,
  hoy,
  soloLectura,
  onClose,
  onAccion,
}: {
  recibo: Recibo | null;
  hoy: string;
  soloLectura: boolean;
  onClose: () => void;
  onAccion: (accion: AccionRecibo) => void;
}) {
  return (
    <Sheet open={recibo !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {recibo && (
          <Contenido key={recibo.id} recibo={recibo} hoy={hoy} soloLectura={soloLectura} onClose={onClose} onAccion={onAccion} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Contenido({
  recibo,
  hoy,
  soloLectura,
  onClose,
  onAccion,
}: {
  recibo: Recibo;
  hoy: string;
  soloLectura: boolean;
  onClose: () => void;
  onAccion: (accion: AccionRecibo) => void;
}) {
  const alerta = alertaDe(recibo, hoy);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [borrando, startBorrado] = useTransition();

  function eliminar() {
    startBorrado(async () => {
      const res = await eliminarRecibo(recibo.id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Recibo eliminado");
      setConfirmarBorrado(false);
      onClose();
    });
  }

  return (
    <>
      <SheetHeader className="border-b border-border pr-12">
        <SheetTitle className="text-base">
          {recibo.proveedor} · {recibo.servicio}
        </SheetTitle>
        <SheetDescription>
          Recibo de {periodoLabel(recibo.mes)}
          {recibo.referencia ? ` · Ref. ${recibo.referencia}` : ""}
        </SheetDescription>
        <div className={cn("mt-2 rounded-md border px-3 py-2", TONO_ALERTA[alerta.nivel].chip)}>
          <AlertaIndicador alerta={alerta} />
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <section className="space-y-3">
          <SectionLabel>Progreso</SectionLabel>
          <Progreso recibo={recibo} />
        </section>

        <section className="space-y-2">
          <SectionLabel>Datos</SectionLabel>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Valor</dt>
            <dd className="font-mono tabular-nums">{formatValor(recibo.valor)}</dd>
            <dt className="text-muted-foreground">Referencia</dt>
            <dd className="font-mono">{recibo.referencia ?? "—"}</dd>
            <dt className="text-muted-foreground">Fecha de corte</dt>
            <dd className="font-mono tabular-nums">{formatFecha(recibo.fecha_corte)}</dd>
            {recibo.observaciones && (
              <>
                <dt className="text-muted-foreground">Observaciones</dt>
                <dd className="whitespace-pre-wrap">{recibo.observaciones}</dd>
              </>
            )}
          </dl>
        </section>

        <section className="space-y-2">
          <SectionLabel>Soporte de pago</SectionLabel>
          <Soporte recibo={recibo} soloLectura={soloLectura} />
        </section>

        <section className="space-y-2">
          <SectionLabel>Historial</SectionLabel>
          <Historial reciboId={recibo.id} version={recibo.updated_at} />
        </section>
      </div>

      {!soloLectura && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-card px-5 py-3">
          {/* El soporte se adjunta en su propia sección, arriba. */}
          {recibo.estado !== "pagado" && <SiguientePaso recibo={recibo} onAccion={onAccion} />}
          <Button type="button" variant="outline" size="sm" onClick={() => onAccion({ tipo: "editar", recibo })}>
            <Pencil className="size-3.5" />
            Editar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={() => setConfirmarBorrado(true)}
          >
            <Trash2 className="size-3.5" />
            Eliminar
          </Button>
        </div>
      )}

      <AlertDialog open={confirmarBorrado} onOpenChange={setConfirmarBorrado}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este recibo?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra el recibo de {recibo.proveedor} · {recibo.servicio} de {periodoLabel(recibo.mes)}, su soporte y
              su historial. Úsalo solo para corregir un error: los recibos de meses anteriores se conservan como
              histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost" disabled={borrando}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={borrando}
              onClick={(e) => {
                e.preventDefault();
                eliminar();
              }}
            >
              {borrando && <Loader2 className="size-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Factura → Registro → Pago → Soporte. Verde = hecho, ámbar = el paso actual (uno solo). */
function Progreso({ recibo }: { recibo: Recibo }) {
  const pasos = [
    { label: "Factura recibida", fecha: recibo.fecha_recibido },
    { label: "Registrado (Tesorería)", fecha: recibo.fecha_registro },
    { label: "Pagado", fecha: recibo.fecha_pago },
    { label: "Soporte adjunto", fecha: recibo.soporte_subido_at?.slice(0, 10) ?? null },
  ];
  const actual = pasos.findIndex((p) => !p.fecha);
  return (
    <ol className="space-y-2">
      {pasos.map((p, i) => {
        const hecho = Boolean(p.fecha);
        const esActual = i === actual;
        return (
          <li key={p.label} className="flex items-center gap-3">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold",
                hecho && "bg-emerald-600 text-white dark:bg-emerald-500",
                esActual && "bg-amber-400 text-amber-950",
                !hecho && !esActual && "bg-muted text-muted-foreground",
              )}
            >
              {hecho ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn("flex-1 text-sm", !hecho && !esActual && "text-muted-foreground")}>{p.label}</span>
            {hecho ? (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatFecha(p.fecha)}</span>
            ) : (
              <span className={cn("text-xs", esActual ? "font-medium text-foreground" : "text-muted-foreground")}>
                {esActual ? "Siguiente" : "Pendiente"}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Soporte({ recibo, soloLectura }: { recibo: Recibo; soloLectura: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [accion, setAccion] = useState<"ver" | "subir" | "quitar" | null>(null);

  function ver() {
    // Se abre la pestaña antes de esperar al servidor para que el navegador no la bloquee.
    const ventana = window.open("", "_blank");
    setAccion("ver");
    startTransition(async () => {
      const res = await urlSoporte(recibo.id);
      if (!res.url) {
        ventana?.close();
        toast.error(res.error ?? "No se pudo abrir el soporte.");
        return;
      }
      if (ventana) ventana.location.href = res.url;
      else window.location.href = res.url;
    });
  }

  function subir(file: File) {
    setAccion("subir");
    startTransition(async () => {
      const res = await subirSoporte(recibo.id, file);
      if (!res.ok) toast.error(res.error);
      else toast.success(recibo.soporte_nombre ? "Soporte reemplazado" : "Soporte adjuntado");
    });
  }

  function quitar() {
    setAccion("quitar");
    startTransition(async () => {
      const res = await quitarSoporte(recibo.id);
      if (res.error) toast.error(res.error);
      else toast.success("Soporte quitado");
    });
  }

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={SOPORTE_ACCEPT}
      className="sr-only"
      tabIndex={-1}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) subir(file);
      }}
    />
  );
  const spinner = (a: typeof accion) => pending && accion === a && <Loader2 className="size-3.5 animate-spin" />;

  if (recibo.soporte_nombre) {
    return (
      <div className="space-y-2 rounded-md border border-border px-3 py-2.5">
        <div className="flex items-center gap-2 text-sm">
          <FileText className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium" title={recibo.soporte_nombre}>
            {recibo.soporte_nombre}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={ver} disabled={pending}>
            {spinner("ver")}
            Ver soporte
          </Button>
          {!soloLectura && (
            <>
              <Button type="button" size="sm" variant="ghost" onClick={() => inputRef.current?.click()} disabled={pending}>
                {spinner("subir")}
                Reemplazar
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={quitar} disabled={pending}>
                {spinner("quitar")}
                Quitar
              </Button>
              {input}
            </>
          )}
        </div>
      </div>
    );
  }

  if (recibo.estado !== "pagado") {
    return <p className="text-sm text-muted-foreground">Se adjunta cuando el recibo esté pagado.</p>;
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-amber-300 px-3 py-2.5 dark:border-amber-800">
      <span className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
        <Paperclip className="size-4" />
        Falta el soporte
      </span>
      {!soloLectura && (
        <>
          <Button type="button" size="sm" onClick={() => inputRef.current?.click()} disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Adjuntar
          </Button>
          {input}
        </>
      )}
    </div>
  );
}

function textoEvento(e: EventoHistorial): string {
  const estado = (s: string) => (esEstado(s) ? ESTADO_CORTO[s] : s);
  switch (e.evento) {
    case "creado":
      return `Creado · ${estado(e.detalle)}`;
    case "estado": {
      const [de, a] = e.detalle.split(" → ");
      return `${estado(de ?? "")} → ${estado(a ?? "")}`;
    }
    case "valor": {
      const [de, a] = e.detalle.split(" → ").map((v) => (Number.isFinite(Number(v)) ? formatValor(Number(v)) : v));
      return `Valor: ${de} → ${a}`;
    }
    case "soporte":
      return `Soporte ${e.detalle.charAt(0).toLowerCase()}${e.detalle.slice(1)}`;
  }
}

const FECHA_HORA = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Bogota",
});

/** `version` (updated_at del recibo) recarga el historial después de cada cambio. */
function Historial({ reciboId, version }: { reciboId: string; version: string }) {
  const [estado, setEstado] = useState<{ eventos?: EventoHistorial[]; error?: string } | null>(null);

  useEffect(() => {
    let vigente = true;
    getHistorialRecibo(reciboId).then((res) => {
      if (vigente) setEstado(res);
    });
    return () => {
      vigente = false;
    };
  }, [reciboId, version]);

  if (!estado) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Cargando…
      </p>
    );
  }
  if (estado.error) return <p className="text-sm text-destructive">{estado.error}</p>;
  if (!estado.eventos?.length) return <p className="text-sm text-muted-foreground">Sin movimientos.</p>;

  return (
    <ol className="space-y-2 border-l border-border pl-4">
      {estado.eventos.map((e) => (
        <li key={e.id} className="text-sm">
          <p>{textoEvento(e)}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{FECHA_HORA.format(new Date(e.at))}</span>
            {e.usuario ? ` · ${e.usuario}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

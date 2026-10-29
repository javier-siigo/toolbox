"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  HandCoins,
  Plus,
  UserMinus,
  Wallet,
} from "lucide-react";

import { SoloLectura } from "@/components/common/solo-lectura";
import { ComoUsar } from "@/components/tour/como-usar";
import { Button } from "@/components/ui/button";
import { AnticiposDataTable } from "@/components/anticipos/anticipos-data-table";
import { AnticiposDeleteDialog } from "@/components/anticipos/anticipos-delete-dialog";
import { AnticiposEditSheet } from "@/components/anticipos/anticipos-edit-sheet";
import { AnticiposFormSheet } from "@/components/anticipos/anticipos-form";
import { ImportarRetiradosSheet } from "@/components/anticipos/importar-retirados/importar-retirados-sheet";
import { TOUR_ANTICIPOS } from "@/components/anticipos/tour";
import type { AnticipoRow } from "@/lib/anticipos/schema";

const HIGHLIGHT_ADD_MS = 720;
const HIGHLIGHT_LEGALIZE_MS = 640;

function isPendienteFalta(value: AnticipoRow["falta"]): boolean {
  return value !== "legalizado";
}

function isDevolucionFalta(value: AnticipoRow["falta"]): boolean {
  return value === "devolucion";
}

function isLegalizadoFalta(value: AnticipoRow["falta"]): boolean {
  return value === "legalizado";
}

/** `soloLectura` (nivel `ver`): consulta la tabla sin crear, editar, legalizar ni importar. */
export function AnticiposPageClient({
  rows,
  soloLectura = false,
}: {
  rows: AnticipoRow[];
  soloLectura?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<AnticipoRow | null>(null);
  const [deletingRow, setDeletingRow] = useState<AnticipoRow | null>(null);
  const [highlightedRowIds, setHighlightedRowIds] = useState<{
    added: Set<string>;
    legalized: Set<string>;
  }>({ added: new Set(), legalized: new Set() });

  const prevRowsRef = useRef<AnticipoRow[]>([]);
  const highlightTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );

  useEffect(() => {
    const prevById = new Map(prevRowsRef.current.map((r) => [r.id, r]));
    const initialMount = prevRowsRef.current.length === 0;
    const newIds: string[] = [];
    const newlyLegalizedIds: string[] = [];
    for (const row of rows) {
      const prev = prevById.get(row.id);
      if (!prev) {
        if (!initialMount) newIds.push(row.id);
        continue;
      }
      if (prev.falta !== "legalizado" && row.falta === "legalizado") {
        newlyLegalizedIds.push(row.id);
      }
    }

    if (newIds.length > 0 || newlyLegalizedIds.length > 0) {
      setHighlightedRowIds((prev) => {
        const added = new Set(prev.added);
        const legalized = new Set(prev.legalized);
        for (const id of newIds) added.add(id);
        for (const id of newlyLegalizedIds) legalized.add(id);
        return { added, legalized };
      });

      for (const id of newIds) {
        const timer = setTimeout(() => {
          highlightTimersRef.current.delete(timer);
          setHighlightedRowIds((prev) => {
            if (!prev.added.has(id)) return prev;
            const added = new Set(prev.added);
            added.delete(id);
            return { added, legalized: prev.legalized };
          });
        }, HIGHLIGHT_ADD_MS);
        highlightTimersRef.current.add(timer);
      }

      for (const id of newlyLegalizedIds) {
        const timer = setTimeout(() => {
          highlightTimersRef.current.delete(timer);
          setHighlightedRowIds((prev) => {
            if (!prev.legalized.has(id)) return prev;
            const legalized = new Set(prev.legalized);
            legalized.delete(id);
            return { added: prev.added, legalized };
          });
        }, HIGHLIGHT_LEGALIZE_MS);
        highlightTimersRef.current.add(timer);
      }
    }

    prevRowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    return () => {
      for (const timer of highlightTimersRef.current) clearTimeout(timer);
      highlightTimersRef.current.clear();
    };
  }, []);

  const stats = useMemo(() => {
    const total = rows.length;
    const pendientes = rows.filter((r) => isPendienteFalta(r.falta)).length;
    const devoluciones = rows.filter((r) => isDevolucionFalta(r.falta)).length;
    const legalizados = rows.filter((r) => isLegalizadoFalta(r.falta)).length;
    const tasaLegalizacion = total === 0 ? 0 : Math.round((legalizados / total) * 100);
    const excolaboradores = rows.filter((r) => r.es_retirado).length;
    const valorPendienteRetirados = rows
      .filter((r) => r.es_retirado && isPendienteFalta(r.falta))
      .reduce((acc, r) => acc + (r.retiro_info?.valor ?? 0), 0);
    return {
      total,
      pendientes,
      devoluciones,
      legalizados,
      tasaLegalizacion,
      excolaboradores,
      valorPendienteRetirados,
    };
  }, [rows]);

  const valorFmt = useMemo(() => {
    if (stats.valorPendienteRetirados <= 0) return null;
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(stats.valorPendienteRetirados);
  }, [stats.valorPendienteRetirados]);

  const closeEdit = useCallback(() => setEditingRow(null), []);
  const closeDelete = useCallback(() => setDeletingRow(null), []);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-tour="kpis">
        <KpiTile
          icon={<HandCoins className="size-4" />}
          label="Total registros"
          value={stats.total}
          tone="default"
          staggerIndex={0}
        />
        <KpiTile
          icon={<Wallet className="size-4" />}
          label="Pendientes"
          value={stats.pendientes}
          tone="warning"
          staggerIndex={1}
        />
        <KpiTile
          icon={<ArrowUpRight className="size-4" />}
          label="Devoluciones"
          value={stats.devoluciones}
          tone="destructive"
          staggerIndex={2}
        />
        <KpiTile
          icon={<CheckCircle2 className="size-4" />}
          label="Legalizados"
          value={stats.legalizados}
          tone="success"
          staggerIndex={3}
          suffix={
            stats.total > 0 ? (
              <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                {stats.tasaLegalizacion}% del total
              </span>
            ) : null
          }
        />
        <KpiTile
          icon={<UserMinus className="size-4" />}
          label="Excolaboradores"
          value={stats.excolaboradores}
          tone="muted"
          staggerIndex={4}
          suffix={
            valorFmt ? (
              <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                Pendiente: {valorFmt}
              </span>
            ) : null
          }
          action={
            !soloLectura && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setImportOpen(true)}
                data-tour="importar"
                className="h-auto p-0 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {stats.excolaboradores > 0
                  ? "Actualizar reporte →"
                  : "Importar reporte →"}
              </Button>
            )
          }
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col-reverse items-start justify-between gap-2 sm:flex-row sm:items-center sm:gap-3">
          <p className="text-sm text-muted-foreground">
            Gestiona y legaliza los anticipos por colaborador y
            requerimiento. Importa el reporte de Contabilidad para cruzar
            excolaboradores retirados.
          </p>
          <div className="flex shrink-0 gap-2">
            <ComoUsar steps={TOUR_ANTICIPOS} className="h-9" />
            {!soloLectura && (
              <Button type="button" onClick={() => setOpen(true)} data-tour="nuevo">
                <Plus className="size-4" />
                Nuevo registro
              </Button>
            )}
          </div>
        </div>

        {soloLectura && <SoloLectura />}

        <AnticiposDataTable
          rows={rows}
          onEdit={soloLectura ? undefined : setEditingRow}
          onDelete={soloLectura ? undefined : setDeletingRow}
          highlightedRowIds={highlightedRowIds}
        />
      </div>

      <AnticiposFormSheet open={open} onOpenChange={setOpen} />
      <ImportarRetiradosSheet open={importOpen} onOpenChange={setImportOpen} />
      <AnticiposEditSheet
        row={editingRow}
        open={Boolean(editingRow)}
        onOpenChange={closeEdit}
      />
      <AnticiposDeleteDialog
        row={deletingRow}
        open={Boolean(deletingRow)}
        onOpenChange={closeDelete}
      />
    </div>
  );
}

type KpiTone = "default" | "success" | "warning" | "destructive" | "muted";

interface KpiTileProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: KpiTone;
  suffix?: React.ReactNode;
  action?: React.ReactNode;
  staggerIndex: number;
}

const TONE_CLASSES: Record<KpiTone, string> = {
  default:
    "bg-primary/10 text-primary border-primary/15 dark:bg-primary/15 dark:text-primary-foreground/90 dark:border-primary/30",
  success:
    "bg-emerald-100 text-emerald-700 border-emerald-200/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40",
  warning:
    "bg-amber-100 text-amber-700 border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40",
  destructive:
    "bg-rose-100 text-rose-700 border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40",
  muted:
    "bg-muted text-muted-foreground border-border",
};

function KpiTile({
  icon,
  label,
  value,
  tone = "default",
  suffix,
  action,
  staggerIndex,
}: KpiTileProps) {
  return (
    <div
      className="kpi-tile-stagger flex flex-col gap-2 rounded-lg border border-border bg-card p-4 shadow-sm"
      style={{ animationDelay: `${staggerIndex * 40}ms` }}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-md border ${TONE_CLASSES[tone]}`}
          aria-hidden
        >
          {icon}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xl font-semibold tabular-nums text-foreground">
              {value}
            </span>
            {suffix}
          </div>
        </div>
      </div>
      {action ? (
        <div className="flex justify-end">{action}</div>
      ) : null}
    </div>
  );
}
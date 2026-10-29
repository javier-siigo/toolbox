"use client";

import * as React from "react";
import { useTransition } from "react";
import type { CSSProperties } from "react";
import {
  type ColumnFiltersState,
  type ColumnSizingState,
  type ColumnVisibilityState,
  type SortingState,
  createColumnHelper,
  useTable,
} from "@tanstack/react-table";
import {
  BadgeCheck,
  Columns3,
  Filter,
  FilterX,
  Inbox,
  Loader2,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
  UserMinus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  ANTICIPOS_FALTA_LABELS,
  ANTICIPOS_OBSERVACION_1_LABELS,
  type AnticipoFalta,
  type AnticipoObservacion1,
  type AnticipoRow,
} from "@/lib/anticipos/schema";

import { columns } from "./columns";
import { features } from "./data-table-features";
import type { DataTableFeatures } from "./data-table-features";
import { legalizeAnticipo } from "@/lib/anticipos/actions";

interface AnticiposDataTableProps {
  rows: AnticipoRow[];
  /** Sin handlers (nivel `ver`) la tabla no muestra la columna de acciones. */
  onEdit?: (row: AnticipoRow) => void;
  onDelete?: (row: AnticipoRow) => void;
  highlightedRowIds?: {
    added?: ReadonlySet<string>;
    legalized?: ReadonlySet<string>;
  };
}

const columnHelper = createColumnHelper<DataTableFeatures, AnticipoRow>();

function RowActionsDropdown({
  row,
  onEdit,
  onDelete,
}: {
  row: AnticipoRow;
  onEdit: (row: AnticipoRow) => void;
  onDelete: (row: AnticipoRow) => void;
}) {
  const isLegalized = row.falta === "legalizado";
  const [isLegalizing, startLegalizeTransition] = useTransition();

  function handleLegalize() {
    const id = row.id;
    startLegalizeTransition(async () => {
      const res = await legalizeAnticipo(id);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success("Anticipo legalizado");
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Abrir acciones"
          className="size-8 text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onEdit(row)}>
          <Pencil data-icon="inline-start" />
          Editar registro
        </DropdownMenuItem>
        {!isLegalized && (
          <DropdownMenuItem
            onSelect={handleLegalize}
            disabled={isLegalizing}
          >
            {isLegalizing ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <BadgeCheck data-icon="inline-start" />
            )}
            {isLegalizing ? "Legalizando…" : "Legalizar anticipo"}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onDelete(row)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 data-icon="inline-start" />
          Eliminar registro
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const DEFAULT_PAGE_SIZE = 5;
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100] as const;
const ALL = "__all__";
const COLUMN_SIZING_STORAGE_KEY = "toolbox:anticipos:columnSizing:v2";

function loadColumnSizing(): ColumnSizingState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COLUMN_SIZING_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ColumnSizingState;
    }
  } catch {
    // ignore
  }
  return {};
}

function saveColumnSizing(state: ColumnSizingState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      COLUMN_SIZING_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // quota or disabled storage; ignore
  }
}

function buildPageItems(currentPage: number, totalPages: number): Array<
  | { kind: "page"; page: number }
  | { kind: "ellipsis"; key: string }
> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => ({
      kind: "page" as const,
      page: i,
    }));
  }

  const items: Array<
    { kind: "page"; page: number } | { kind: "ellipsis"; key: string }
  > = [];
  const push = (page: number) => items.push({ kind: "page", page });
  const ellipsis = (key: string) => items.push({ kind: "ellipsis", key });

  push(0);
  const start = Math.max(1, currentPage - 1);
  const end = Math.min(totalPages - 2, currentPage + 1);

  if (start > 1) ellipsis("start");
  for (let i = start; i <= end; i++) push(i);
  if (end < totalPages - 2) ellipsis("end");
  push(totalPages - 1);

  return items;
}

function matchesEnum<T extends string>(
  value: T | null | undefined,
  filter: string,
): boolean {
  if (!filter || filter === ALL) return true;
  return value === filter;
}

export function AnticiposDataTable({
  rows,
  onEdit,
  onDelete,
  highlightedRowIds,
}: AnticiposDataTableProps) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [columnVisibility, setColumnVisibility] =
    React.useState<ColumnVisibilityState>({});
  const [columnSizing, setColumnSizing] = React.useState<ColumnSizingState>({});

  React.useEffect(() => {
    const stored = loadColumnSizing();
    if (Object.keys(stored).length > 0) {
      setColumnSizing(stored);
    }
  }, []);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [faltaFilter, setFaltaFilter] = React.useState<string>("");
  const [observacion1Filter, setObservacion1Filter] = React.useState<string>("");
  const [onlyRetirados, setOnlyRetirados] = React.useState(false);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [pageSize, setPageSize] = React.useState<number>(DEFAULT_PAGE_SIZE);

  const handleColumnSizingChange = React.useCallback(
    (updater: React.SetStateAction<ColumnSizingState>) => {
      setColumnSizing((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (old: ColumnSizingState) => ColumnSizingState)(prev)
            : updater;
        saveColumnSizing(next);
        return next;
      });
    },
    [],
  );

  const filteredRows = React.useMemo(() => {
    return rows.filter((row) => {
      if (onlyRetirados && !row.es_retirado) return false;
      if (!matchesEnum<AnticipoFalta>(row.falta, faltaFilter)) return false;
      if (!matchesEnum<AnticipoObservacion1>(row.observacion_1, observacion1Filter))
        return false;
      if (globalFilter) {
        const q = globalFilter.toLowerCase();
        const haystack =
          `${row.nombre} ${row.requerimiento} ${row.observacion_2 ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [rows, faltaFilter, observacion1Filter, globalFilter, onlyRetirados]);

  React.useEffect(() => {
    setPageIndex(0);
  }, [pageSize, faltaFilter, observacion1Filter, globalFilter, onlyRetirados]);

  const actionsColumn = React.useMemo(
    () =>
      onEdit && onDelete &&
      columnHelper.display({
        id: "actions",
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <RowActionsDropdown
              row={row.original}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        size: 50,
        minSize: 48,
      }),
    [onEdit, onDelete],
  );

  const fullColumns = React.useMemo(
    () => (actionsColumn ? [...columns, actionsColumn] : columns),
    [actionsColumn],
  );

  const tableRef = React.useRef<HTMLTableElement>(null);

  const table = useTable({
    features,
    data: filteredRows,
    columns: fullColumns,
    columnResizeMode: "onChange",
    defaultColumn: { minSize: 96 },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: handleColumnSizingChange,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      columnSizing,
      globalFilter,
      pagination: { pageIndex, pageSize },
    },
    onPaginationChange: (updater) => {
      setPageIndex((prev) => {
        const next =
          typeof updater === "function"
            ? updater({ pageIndex: prev, pageSize })
            : updater;
        if (next.pageSize !== pageSize) {
          setPageSize(next.pageSize);
        }
        return next.pageIndex;
      });
    },
    getRowId: (row) => row.id,
  });

  const totalCurrentSize = React.useMemo(
    () =>
      table.getAllColumns().reduce((acc, c) => acc + c.getSize(), 0) || 1,
    [table],
  );

  const cellWidthStyle = React.useCallback(
    (size: number, minSize?: number): CSSProperties => {
      const pct = (size / totalCurrentSize) * 100;
      return {
        width: `${pct}%`,
        minWidth: minSize ? `${minSize}px` : undefined,
      };
    },
    [totalCurrentSize],
  );

  const autoFitColumn = React.useCallback(
    (columnId: string) => {
      const tableEl = tableRef.current;
      if (!tableEl) return;

      const cells = tableEl.querySelectorAll<HTMLElement>(
        `[data-column-id="${CSS.escape(columnId)}"]`,
      );
      if (cells.length === 0) return;

      const probe = document.createElement("div");
      probe.style.cssText =
        "position:absolute;visibility:hidden;left:-9999px;top:0;width:auto;min-width:0;max-width:none;";
      document.body.appendChild(probe);

      let maxWidth = 0;
      for (const cell of cells) {
        const clone = cell.cloneNode(true) as HTMLElement;
        clone.removeAttribute("style");
        clone.style.cssText = probe.style.cssText;
        probe.appendChild(clone);
        const w = clone.scrollWidth;
        if (w > maxWidth) maxWidth = w;
        probe.removeChild(clone);
      }
      document.body.removeChild(probe);

      const cs = window.getComputedStyle(cells[0]!);
      const paddingX =
        parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const measured = Math.ceil(maxWidth + paddingX);

      const column = table.getColumn(columnId);
      const minSize =
        (column?.columnDef.minSize as number | undefined) ?? 0;
      const capped = Math.min(Math.max(measured, minSize), 600);

      setColumnSizing((prev) => {
        const next = { ...prev, [columnId]: capped };
        saveColumnSizing(next);
        return next;
      });
    },
    [table],
  );

  const totalRows = rows.length;
  const totalFiltered = table.getFilteredRowModel().rows.length;
  const visibleRows = table.getRowModel().rows;
  const totalPages = Math.max(1, table.getPageCount());
  const pageItems = buildPageItems(pageIndex, totalPages);

  const hasFilters =
    faltaFilter !== "" ||
    observacion1Filter !== "" ||
    globalFilter.trim().length > 0 ||
    onlyRetirados;

  const resetFilters = () => {
    setFaltaFilter("");
    setObservacion1Filter("");
    setGlobalFilter("");
    setOnlyRetirados(false);
  };

  const faltaActive = faltaFilter !== "";
  const observacionActive = observacion1Filter !== "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3" data-tour="filtros">
        <div className="relative" data-tour="buscar">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Buscar colaborador o requerimiento"
            aria-label="Buscar en la tabla"
            className="h-9 w-80 pl-7 pr-7 text-sm"
          />
          {globalFilter && (
            <button
              type="button"
              onClick={() => setGlobalFilter("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        <EnumFilterSelect
          label="Falta"
          ariaLabel="Filtrar por falta"
          value={faltaFilter}
          onChange={setFaltaFilter}
          isActive={faltaActive}
          options={Object.entries(ANTICIPOS_FALTA_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
        />

        <EnumFilterSelect
          label="Observación 1"
          ariaLabel="Filtrar por observación"
          value={observacion1Filter}
          onChange={setObservacion1Filter}
          isActive={observacionActive}
          options={Object.entries(ANTICIPOS_OBSERVACION_1_LABELS).map(
            ([value, label]) => ({ value, label }),
          )}
        />

        <Button
          type="button"
          variant={onlyRetirados ? "default" : "outline"}
          size="sm"
          onClick={() => setOnlyRetirados((v) => !v)}
          aria-pressed={onlyRetirados}
          aria-label="Mostrar sólo excolaboradores"
          className={cn(
            "h-9 gap-1.5 text-xs",
            onlyRetirados &&
              "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15",
          )}
        >
          <UserMinus className="size-3.5" />
          Excolaboradores
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 text-xs"
            >
              <Columns3 className="size-3.5" />
              Columnas
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Mostrar columnas</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {table
              .getAllColumns()
              .filter((column) => column.getCanHide())
              .map((column) => {
                const headerLabel =
                  typeof column.columnDef.header === "string"
                    ? column.columnDef.header
                    : (column.id ?? "");
                return (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) =>
                      column.toggleVisibility(Boolean(value))
                    }
                    onSelect={(e) => e.preventDefault()}
                  >
                    {headerLabel || column.id}
                  </DropdownMenuCheckboxItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>

        {hasFilters && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {totalFiltered} de {totalRows}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-9 gap-1.5 text-xs"
            >
              <FilterX className="size-3.5" />
              Limpiar filtros
            </Button>
          </div>
        )}
      </div>

      {visibleRows.length ? (
        <Card className="overflow-hidden" data-tour="tabla">
          <CardContent className="p-0">
            <Table ref={tableRef} className="table-fixed">
              <TableHeader className="bg-muted/40">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className="border-b hover:bg-transparent data-[state=selected]:bg-transparent"
                  >
                    {headerGroup.headers.map((header) => {
                      const isActions = header.column.id === "actions";
                      const canResize = header.column.getCanResize();
                      const isResizing = header.column.getIsResizing();
                      return (
                        <TableHead
                          key={header.id}
                          data-column-id={header.column.id}
                          style={cellWidthStyle(
                            header.getSize(),
                            header.column.columnDef.minSize as number | undefined,
                          )}
                          className={cn(
                            "relative h-9 align-bottom",
                            isActions &&
                              "sticky right-0 z-20 border-l border-border bg-card",
                          )}
                        >
                          {header.isPlaceholder ? null : (
                            <table.FlexRender header={header} />
                          )}
                          {canResize && (
                            <div
                              role="separator"
                              aria-orientation="vertical"
                              aria-label={`Redimensionar ${header.column.id} (doble clic para auto-ajustar)`}
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              onDoubleClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                autoFitColumn(header.column.id);
                              }}
                              className="group/resize absolute top-0 right-0 z-10 flex h-full w-2 -translate-x-1/2 cursor-col-resize touch-none select-none items-center justify-center"
                            >
                              <span
                                aria-hidden
                                className={cn(
                                  "block h-full w-px transition-colors",
                                  isResizing
                                    ? "bg-primary"
                                    : "bg-transparent group-hover/resize:bg-primary/50",
                                )}
                              />
                            </div>
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {visibleRows.map((row, index) => {
                  const id = row.id;
                  const justAdded = highlightedRowIds?.added?.has(id) ?? false;
                  const justLegalized =
                    highlightedRowIds?.legalized?.has(id) ?? false;
                  const isRetirado = row.original.es_retirado;
                  return (
                    <TableRow
                      key={id}
                      className={cn("group", isRetirado && "bg-muted/30")}
                      data-just-added={justAdded ? "true" : undefined}
                      data-just-legalized={justLegalized ? "true" : undefined}
                      // El recorrido "¿Cómo usar?" explica las acciones con la primera fila.
                      data-tour={index === 0 ? "fila" : undefined}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const isActions = cell.column.id === "actions";
                        return (
                          <TableCell
                            key={cell.id}
                            data-column-id={cell.column.id}
                            className={cn(
                              "py-2.5",
                              isActions &&
                                "sticky right-0 z-10 border-l border-border bg-card",
                            )}
                            style={cellWidthStyle(
                              cell.column.getSize(),
                              cell.column.columnDef.minSize as
                                | number
                                | undefined,
                            )}
                          >
                            <table.FlexRender cell={cell} />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : hasFilters ? (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Empty className="border-0 bg-transparent py-14">
              <EmptyHeader className="sm:max-w-lg">
                <EmptyMedia variant="icon">
                  <FilterX />
                </EmptyMedia>
                <EmptyTitle>
                  Sin coincidencias con los filtros activos
                </EmptyTitle>
                <EmptyDescription>
                  Ningún registro coincide con la búsqueda o los filtros
                  aplicados. Ajusta los criterios para ver más resultados.
                </EmptyDescription>
              </EmptyHeader>
              <Button
                variant="outline"
                size="sm"
                onClick={resetFilters}
                className="mt-2"
              >
                <FilterX className="size-3.5" />
                Limpiar filtros
              </Button>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Empty className="border-0 bg-transparent py-14">
              <EmptyHeader className="sm:max-w-lg">
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>Aún no hay registros</EmptyTitle>
                <EmptyDescription>
                  Cuando registres un anticipo aparecerá aquí. Usa el botón
                  «Nuevo registro» para comenzar.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </CardContent>
        </Card>
      )}

      {(totalPages > 1 || totalFiltered > 0) && (
        <div
          className="flex flex-col-reverse items-stretch justify-between gap-3 px-1 sm:flex-row sm:items-center"
          data-tour="paginacion"
        >
          <p className="text-xs text-muted-foreground tabular-nums">
            {totalRows === 0
              ? "Sin registros."
              : totalFiltered === 0
                ? "Ningún registro coincide con los filtros."
                : `Mostrando ${pageIndex * pageSize + 1}–${Math.min(
                    (pageIndex + 1) * pageSize,
                    totalFiltered,
                  )} de ${totalFiltered} registros${
                    totalFiltered !== totalRows
                      ? ` (filtrados de ${totalRows})`
                      : ""
                  }.`}
          </p>
          <div className="flex items-center justify-end gap-3">
            <Select
              value={String(pageSize)}
              onValueChange={(v) => setPageSize(Number(v))}
            >
              <SelectTrigger
                aria-label="Filas por página"
                className="h-8 w-auto gap-1.5 px-2.5 text-xs font-normal shadow-none"
              >
                <span className="text-muted-foreground">Filas:</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {totalPages > 1 && (
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        table.previousPage();
                      }}
                      aria-disabled={!table.getCanPreviousPage()}
                      className={
                        !table.getCanPreviousPage()
                          ? "pointer-events-none opacity-50"
                          : undefined
                      }
                    />
                  </PaginationItem>

                  {pageItems.map((item, idx) => {
                    if (item.kind === "ellipsis") {
                      return (
                        <PaginationItem key={`${item.key}-${idx}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      );
                    }
                    const page = item.page;
                    return (
                      <PaginationItem key={page}>
                        <PaginationLink
                          href="#"
                          isActive={page === pageIndex}
                          onClick={(e) => {
                            e.preventDefault();
                            table.setPageIndex(page);
                          }}
                        >
                          {page + 1}
                        </PaginationLink>
                      </PaginationItem>
                    );
                  })}

                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        table.nextPage();
                      }}
                      aria-disabled={!table.getCanNextPage()}
                      className={
                        !table.getCanNextPage()
                          ? "pointer-events-none opacity-50"
                          : undefined
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EnumFilterSelect({
  label,
  ariaLabel,
  value,
  onChange,
  isActive,
  options,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  isActive: boolean;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-9 w-44 gap-1.5 overflow-hidden text-xs font-normal shadow-none",
          isActive &&
            "border-primary/40 bg-primary/5 text-foreground ring-1 ring-primary/20",
        )}
      >
        <Filter
          className={cn(
            "size-3 shrink-0",
            isActive ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="flex min-w-0 flex-1 items-center gap-1 truncate text-left">
          <span className="shrink-0 text-muted-foreground">{label}:</span>
          <SelectValue placeholder="Todas" />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Todas</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

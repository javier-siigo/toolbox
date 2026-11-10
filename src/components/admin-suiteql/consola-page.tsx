"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  DatabaseZap,
  History,
  Loader2,
  Play,
  Square,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Resultado {
  filas: Record<string, unknown>[];
  columnas: string[];
  total: number | null;
  truncado: boolean;
  duracionMs: number;
}

type Estado =
  | { tipo: "inicial" }
  | { tipo: "cargando"; desde: number }
  | { tipo: "error"; mensaje: string; codigo?: string }
  | { tipo: "ok"; resultado: Resultado; query: string };

const LIMITES = ["10", "50", "100", "500", "1000", "todas"] as const;
const POR_PAGINA = 100;
const JSON_VISTA = 200;
const RECIENTES_KEY = "toolbox:suiteql-recientes";
const MAX_RECIENTES = 10;
const QUERY_INICIAL =
  "SELECT id, tranid, trandate, type\nFROM transaction\nORDER BY id DESC";

const num = new Intl.NumberFormat("es-CO");
const NUMERICO = /^-?\d+(\.\d+)?$/;
type Vista = "tabla" | "json";

/** Columnas cuyos valores no nulos son todos números: se alinean a la derecha. */
function columnasNumericas(
  columnas: string[],
  filas: Record<string, unknown>[],
): Set<string> {
  const muestra = filas.slice(0, 500);
  return new Set(
    columnas.filter((c) => {
      let alguno = false;
      for (const f of muestra) {
        const v = f[c];
        if (v === null || v === undefined || v === "") continue;
        if (
          typeof v !== "number" &&
          !(typeof v === "string" && NUMERICO.test(v))
        )
          return false;
        alguno = true;
      }
      return alguno;
    }),
  );
}

function leerRecientes(): string[] {
  try {
    const raw = window.localStorage.getItem(RECIENTES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((q): q is string => typeof q === "string")
      : [];
  } catch {
    return [];
  }
}

function guardarRecientes(lista: string[]) {
  try {
    window.localStorage.setItem(RECIENTES_KEY, JSON.stringify(lista));
  } catch {
    // Sin almacenamiento: los recientes solo viven en memoria.
  }
}

function celda(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function aCsv(columnas: string[], filas: Record<string, unknown>[]): string {
  const esc = (s: string) =>
    /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const lineas = [columnas.map(esc).join(",")];
  for (const f of filas)
    lineas.push(columnas.map((c) => esc(celda(f[c]))).join(","));
  return "﻿" + lineas.join("\r\n");
}

function descargar(contenido: string, nombre: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

function marcaDeTiempo() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

export function ConsolaSuiteQL({ queryInicial }: { queryInicial?: string }) {
  const [query, setQuery] = useState(queryInicial || QUERY_INICIAL);
  const [limite, setLimite] = useState<(typeof LIMITES)[number]>("50");
  const [estado, setEstado] = useState<Estado>({ tipo: "inicial" });
  const [recientes, setRecientes] = useState<string[]>([]);
  const [vista, setVista] = useState<Vista>("tabla");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => setRecientes(leerRecientes()), []);

  const cargando = estado.tipo === "cargando";

  async function ejecutar() {
    const q = query.trim();
    if (!q || cargando) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setEstado({ tipo: "cargando", desde: Date.now() });

    const nuevos = [q, ...recientes.filter((r) => r !== q)].slice(
      0,
      MAX_RECIENTES,
    );
    setRecientes(nuevos);
    guardarRecientes(nuevos);

    try {
      const res = await fetch("/api/admin/suiteql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q,
          limite: limite === "todas" ? "todas" : Number(limite),
        }),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as
        | (Resultado & { error?: undefined })
        | { error: string; code?: string }
        | null;
      if (!res.ok || !json || ("error" in json && json.error)) {
        const err = json as { error?: string; code?: string } | null;
        setEstado({
          tipo: "error",
          mensaje: err?.error ?? `El servidor respondió ${res.status}.`,
          codigo: err?.code,
        });
        return;
      }
      setEstado({ tipo: "ok", resultado: json as Resultado, query: q });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setEstado({ tipo: "inicial" });
        toast("Ejecución cancelada");
        return;
      }
      setEstado({
        tipo: "error",
        mensaje: "No se pudo contactar el servidor.",
      });
    } finally {
      abortRef.current = null;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void ejecutar();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="overflow-hidden p-0 transition-[border-color,box-shadow] has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-[3px] has-[textarea:focus-visible]:ring-ring/30">
        <label htmlFor="suiteql-query" className="sr-only">
          Query SuiteQL
        </label>
        <Textarea
          id="suiteql-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          placeholder="SELECT id, tranid FROM transaction WHERE ROWNUM <= 10"
          className="min-h-44 max-h-[55vh] break-normal whitespace-pre rounded-none border-0 bg-card px-5 py-4 font-mono text-[13px] leading-relaxed shadow-none focus-visible:ring-0 md:text-[13px] dark:bg-card"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/40 px-3 py-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={recientes.length === 0}
              >
                <History className="size-4" />
                Recientes
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[min(32rem,90vw)]">
              <DropdownMenuLabel>Últimas queries</DropdownMenuLabel>
              {recientes.map((r) => (
                <DropdownMenuItem
                  key={r}
                  onSelect={() => setQuery(r)}
                  className="font-mono text-xs"
                >
                  <span className="truncate">{r.replace(/\s+/g, " ")}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="hidden text-xs text-muted-foreground sm:inline">
            <kbd className="rounded border border-border bg-card px-1 font-mono text-[11px]">
              Ctrl
            </kbd>{" "}
            +{" "}
            <kbd className="rounded border border-border bg-card px-1 font-mono text-[11px]">
              Enter
            </kbd>{" "}
            ejecuta
          </span>

          <div className="ml-auto flex items-center gap-2">
            <label
              htmlFor="suiteql-limite"
              className="text-xs text-muted-foreground"
            >
              Filas
            </label>
            <Select
              value={limite}
              onValueChange={(v) => setLimite(v as typeof limite)}
            >
              <SelectTrigger
                id="suiteql-limite"
                className="h-8 w-40 bg-card text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMITES.map((l) => (
                  <SelectItem key={l} value={l} className="text-xs">
                    {l === "todas"
                      ? "Todas (hasta 25.000)"
                      : `Primeras ${num.format(Number(l))}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cargando ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => abortRef.current?.abort()}
              >
                <Square className="size-3.5" />
                Cancelar
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void ejecutar()}
                disabled={!query.trim()}
              >
                <Play className="size-3.5" />
                Ejecutar
              </Button>
            )}
          </div>
        </div>
      </Card>

      <ResultadoPanel estado={estado} vista={vista} onVista={setVista} />
    </div>
  );
}

function Cronometro({ desde }: { desde: number }) {
  const [ahora, setAhora] = useState(desde);
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono tabular-nums">
      {((ahora - desde) / 1000).toFixed(1)} s
    </span>
  );
}

function ResultadoPanel({
  estado,
  vista,
  onVista,
}: {
  estado: Estado;
  vista: Vista;
  onVista: (v: Vista) => void;
}) {
  if (estado.tipo === "inicial") {
    return (
      <EmptyState
        icon={<DatabaseZap className="size-5" />}
        title="Sin resultados todavía"
        description="Escribe una query y ejecútala. El resultado aparece aquí como tabla y como JSON."
      />
    );
  }
  if (estado.tipo === "cargando") {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 py-12 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" />
        Consultando NetSuite… <Cronometro desde={estado.desde} />
      </div>
    );
  }
  if (estado.tipo === "error") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/5 px-5 py-4 text-sm"
      >
        <p className="font-semibold text-destructive">La query falló</p>
        <p className="mt-1 font-mono text-[13px] break-words whitespace-pre-wrap text-foreground">
          {estado.mensaje}
        </p>
        {estado.codigo && (
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {estado.codigo}
          </p>
        )}
      </div>
    );
  }
  return (
    <ResultadoOk
      key={estado.query + estado.resultado.duracionMs}
      resultado={estado.resultado}
      vista={vista}
      onVista={onVista}
    />
  );
}

function ResultadoOk({
  resultado,
  vista,
  onVista,
}: {
  resultado: Resultado;
  vista: Vista;
  onVista: (v: Vista) => void;
}) {
  const { filas, columnas, total, truncado, duracionMs } = resultado;
  const [pagina, setPagina] = useState(0);
  const paginas = Math.max(1, Math.ceil(filas.length / POR_PAGINA));
  const visibles = filas.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  const numericas = useMemo(
    () => columnasNumericas(columnas, filas),
    [columnas, filas],
  );
  const jsonVista = useMemo(
    () => JSON.stringify(filas.slice(0, JSON_VISTA), null, 2),
    [filas],
  );

  function copiar() {
    navigator.clipboard
      .writeText(JSON.stringify(filas, null, 2))
      .then(() =>
        toast.success(`${num.format(filas.length)} filas copiadas como JSON`),
      )
      .catch(() => toast.error("No se pudo copiar al portapapeles."));
  }

  return (
    <Tabs
      value={vista}
      onValueChange={(v) => onVista(v as Vista)}
      className="gap-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <TabsList>
          <TabsTrigger value="tabla">Tabla</TabsTrigger>
          <TabsTrigger value="json">JSON</TabsTrigger>
        </TabsList>
        <div className="order-last flex w-full flex-wrap items-center gap-x-3 gap-y-1 sm:order-none sm:w-auto">
          <p className="text-sm text-muted-foreground">
            <span className="font-mono font-medium text-foreground tabular-nums">
              {num.format(filas.length)}
            </span>{" "}
            {filas.length === 1 ? "fila" : "filas"}
            {total !== null && total !== filas.length && (
              <>
                {" "}
                de{" "}
                <span className="font-mono tabular-nums">
                  {num.format(total)}
                </span>
              </>
            )}
            {" · "}
            <span className="font-mono tabular-nums">
              {num.format(columnas.length)}
            </span>{" "}
            columnas
            {" · "}
            <span className="font-mono tabular-nums">
              {(duracionMs / 1000).toFixed(2)} s
            </span>
          </p>
          {truncado && (
            <Badge
              variant="warning"
              title={
                total !== null
                  ? `NetSuite tiene ${num.format(total)} filas para esta query; se trajeron ${num.format(filas.length)}. Sube el límite o filtra la query.`
                  : undefined
              }
            >
              Resultado parcial
            </Badge>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={copiar}
            disabled={filas.length === 0}
          >
            <Copy className="size-3.5" />
            Copiar<span className="hidden sm:inline"> JSON</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={filas.length === 0}
            onClick={() =>
              descargar(
                JSON.stringify(filas, null, 2),
                `suiteql-${marcaDeTiempo()}.json`,
                "application/json",
              )
            }
          >
            <Download className="size-3.5" />
            JSON
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={filas.length === 0}
            onClick={() =>
              descargar(
                aCsv(columnas, filas),
                `suiteql-${marcaDeTiempo()}.csv`,
                "text/csv;charset=utf-8",
              )
            }
          >
            <Download className="size-3.5" />
            CSV
          </Button>
        </div>
      </div>

      {filas.length === 0 ? (
        <EmptyState
          title="La query no devolvió filas"
          description="Revisa los filtros del WHERE o prueba sin ellos."
        />
      ) : (
        <>
          <TabsContent value="tabla" className="mt-0">
            <Card className="overflow-hidden p-0">
              <div className="max-h-[65vh] overflow-auto">
                <table className="w-max min-w-full border-separate border-spacing-0 text-left text-xs">
                  <thead>
                    <tr>
                      <th className="sticky top-0 left-0 z-20 h-9 border-r border-b border-border bg-muted px-3 text-right text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">
                        #
                      </th>
                      {columnas.map((c) => (
                        <th
                          key={c}
                          className={cn(
                            "sticky top-0 z-10 h-9 border-b border-border bg-muted px-3 font-mono text-[11px] font-semibold text-muted-foreground",
                            numericas.has(c) && "text-right",
                          )}
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((fila, i) => (
                      <tr key={pagina * POR_PAGINA + i} className="group">
                        <td className="sticky left-0 border-r border-b border-border bg-card px-3 py-1.5 text-right font-mono text-muted-foreground tabular-nums group-hover:bg-muted">
                          {pagina * POR_PAGINA + i + 1}
                        </td>
                        {columnas.map((c) => {
                          const v = fila[c];
                          const vacio = v === null || v === undefined;
                          const texto = celda(v);
                          return (
                            <td
                              key={c}
                              title={texto.length > 60 ? texto : undefined}
                              className={cn(
                                "max-w-[28rem] truncate border-b border-border px-3 py-1.5 font-mono tabular-nums group-hover:bg-muted",
                                numericas.has(c) && "text-right",
                                vacio && "text-muted-foreground italic",
                              )}
                            >
                              {vacio ? "null" : texto}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {paginas > 1 && (
                <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-mono tabular-nums">
                    {num.format(pagina * POR_PAGINA + 1)}–
                    {num.format(
                      Math.min((pagina + 1) * POR_PAGINA, filas.length),
                    )}{" "}
                    de {num.format(filas.length)}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    aria-label="Página anterior"
                    disabled={pagina === 0}
                    onClick={() => setPagina((p) => p - 1)}
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-7"
                    aria-label="Página siguiente"
                    disabled={pagina >= paginas - 1}
                    onClick={() => setPagina((p) => p + 1)}
                  >
                    <ChevronRight className="size-4" />
                  </Button>
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="json" className="mt-0">
            <Card className="overflow-hidden p-0">
              <pre className="max-h-[65vh] overflow-auto px-5 py-4 font-mono text-xs leading-relaxed">
                {jsonVista}
              </pre>
              {filas.length > JSON_VISTA && (
                <p className="border-t border-border px-5 py-2 text-xs text-muted-foreground">
                  Mostrando las primeras {num.format(JSON_VISTA)} filas de{" "}
                  {num.format(filas.length)}. Copia o descarga el JSON para
                  verlas todas.
                </p>
              )}
            </Card>
          </TabsContent>
        </>
      )}
    </Tabs>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import {
  CopyPlus,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TABLAS,
  TABLA_LABEL,
  TIPO_LABEL,
  ordenColumnas,
  type CampoCatalogo,
  type Plantilla,
} from "@/lib/netsuite/campos";
import {
  filtroActivo,
  filtrosValidos,
  mismosFiltros,
  type Filtro,
} from "@/lib/netsuite/filtros";
import {
  actualizarPlantilla,
  crearPlantilla,
  eliminarPlantilla,
} from "@/lib/netsuite/campos-actions";

import { CatalogoSheet } from "./catalogo-sheet";

const SIN_PLANTILLA = "__ninguna__";

interface CamposCardProps {
  /** Catálogo; con nivel `gestionar` incluye los deshabilitados. */
  campos: CampoCatalogo[];
  plantillas: Plantilla[];
  /** Nivel `gestionar`: administra el catálogo de campos. */
  puedeGestionar: boolean;
  /** Nivel `usar`: crea, guarda y elimina plantillas. Con `ver` solo las aplica. */
  puedeEditarPlantillas: boolean;
  seleccion: Set<string>;
  onSeleccionChange: (next: Set<string>) => void;
  /** Los filtros viajan con la plantilla. */
  filtros: Filtro[];
  onFiltrosChange: (next: Filtro[]) => void;
  plantillaId: string | null;
  onPlantillaChange: (id: string | null) => void;
  disabled: boolean;
}

export function mismosIds(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

export function CamposCard({
  campos,
  plantillas,
  puedeGestionar,
  puedeEditarPlantillas,
  seleccion,
  onSeleccionChange,
  filtros,
  onFiltrosChange,
  plantillaId,
  onPlantillaChange,
  disabled,
}: CamposCardProps) {
  const [busqueda, setBusqueda] = useState("");
  const [guardarComoOpen, setGuardarComoOpen] = useState(false);
  const [eliminarOpen, setEliminarOpen] = useState(false);
  const [catalogoOpen, setCatalogoOpen] = useState(false);
  const [nombreNueva, setNombreNueva] = useState("");
  const [isPending, startTransition] = useTransition();

  const habilitados = useMemo(() => campos.filter((c) => c.habilitado), [campos]);
  const plantilla = plantillas.find((p) => p.id === plantillaId) ?? null;
  const idsPlantilla = useMemo(() => {
    const validos = new Set(habilitados.map((c) => c.id));
    return new Set((plantilla?.campos ?? []).filter((id) => validos.has(id)));
  }, [plantilla, habilitados]);
  const filtrosPlantilla = useMemo(
    () => filtrosValidos(plantilla?.filtros ?? [], new Set(habilitados.map((c) => c.id))),
    [plantilla, habilitados],
  );
  const conCambios =
    plantilla !== null &&
    (!mismosIds(seleccion, idsPlantilla) || !mismosFiltros(filtros, filtrosPlantilla));
  const filtrosAGuardar = () => filtros.filter(filtroActivo);

  const q = busqueda.trim().toLowerCase();
  const visibles = q
    ? habilitados.filter(
        (c) => c.etiqueta.toLowerCase().includes(q) || c.campo.includes(q),
      )
    : habilitados;

  const primerGrupo = TABLAS.find((t) => visibles.some((c) => c.tabla === t));

  const elegirPlantilla = (id: string) => {
    if (id === SIN_PLANTILLA) {
      onPlantillaChange(null);
      return;
    }
    const p = plantillas.find((x) => x.id === id);
    if (!p) return;
    const validos = new Set(habilitados.map((c) => c.id));
    onPlantillaChange(p.id);
    onSeleccionChange(new Set(p.campos.filter((cid) => validos.has(cid))));
    onFiltrosChange(filtrosValidos(p.filtros, validos));
  };

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(seleccion);
    if (checked) next.add(id);
    else next.delete(id);
    onSeleccionChange(next);
  };

  const toggleGrupo = (ids: string[], checked: boolean) => {
    const next = new Set(seleccion);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    onSeleccionChange(next);
  };

  /** Ids seleccionados en el orden de la plantilla y luego del catálogo. */
  const idsOrdenados = () => ordenColumnas(seleccion, habilitados, plantilla?.campos);

  const guardarCambios = () => {
    if (!plantilla) return;
    startTransition(async () => {
      const res = await actualizarPlantilla(plantilla.id, {
        campos: idsOrdenados(),
        filtros: filtrosAGuardar(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Plantilla "${plantilla.nombre}" actualizada`);
    });
  };

  const guardarComo = () => {
    startTransition(async () => {
      const res = await crearPlantilla(nombreNueva, idsOrdenados(), filtrosAGuardar());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onPlantillaChange(res.data.id);
      setGuardarComoOpen(false);
      setNombreNueva("");
      toast.success(`Plantilla "${res.data.nombre}" creada`);
    });
  };

  const eliminar = () => {
    if (!plantilla) return;
    startTransition(async () => {
      const res = await eliminarPlantilla(plantilla.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onPlantillaChange(null);
      setEliminarOpen(false);
      toast.success(`Plantilla "${plantilla.nombre}" eliminada`);
    });
  };

  return (
    <section
      aria-labelledby="campos-title"
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h2
            id="campos-title"
            className="text-base font-semibold tracking-tight text-foreground"
          >
            Campos del Excel
          </h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono tabular-nums">{seleccion.size}</span> de{" "}
            <span className="font-mono tabular-nums">{habilitados.length}</span>{" "}
            seleccionados ·{" "}
            {plantilla
              ? "las columnas salen en el orden de la plantilla; las que agregues, al final."
              : "las columnas salen en el orden del catálogo."}
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 basis-full sm:w-56 sm:basis-auto">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              placeholder="Buscar campo…"
              aria-label="Buscar campo"
              className="pl-8"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          {puedeGestionar && (
            <Button
              variant="outline"
              onClick={() => setCatalogoOpen(true)}
              data-tour="catalogo"
            >
              <Settings2 className="size-4" aria-hidden />
              Administrar catálogo
            </Button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-2" data-tour="plantilla">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-none">
          <Label htmlFor="plantilla">Plantilla</Label>
          <Select
            value={plantillaId ?? SIN_PLANTILLA}
            onValueChange={elegirPlantilla}
            disabled={disabled || isPending}
          >
            <SelectTrigger id="plantilla" className="h-9 w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN_PLANTILLA}>Sin plantilla</SelectItem>
              {plantillas.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {puedeEditarPlantillas && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9"
                aria-label="Más acciones de plantilla"
                disabled={disabled || isPending}
              >
                <MoreHorizontal className="size-4" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={seleccion.size === 0}
                onSelect={() => setGuardarComoOpen(true)}
              >
                <CopyPlus className="size-4" aria-hidden />
                Guardar como nueva…
              </DropdownMenuItem>
              {plantilla && (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setEliminarOpen(true)}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Eliminar “{plantilla.nombre}”
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {conCambios && (
          <>
            <span className="flex h-9 items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
              Modificada
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-9"
              onClick={() => {
                onSeleccionChange(new Set(idsPlantilla));
                onFiltrosChange(filtrosPlantilla);
              }}
              disabled={disabled || isPending}
              aria-label={`Restablecer campos y filtros de "${plantilla.nombre}"`}
              title={`Restablecer campos y filtros de "${plantilla.nombre}"`}
            >
              <RotateCcw className="size-4" aria-hidden />
            </Button>
            {puedeEditarPlantillas && (
              <Button
                variant="outline"
                onClick={guardarCambios}
                disabled={disabled || isPending || seleccion.size === 0}
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                Guardar cambios
              </Button>
            )}
          </>
        )}
      </div>

      {habilitados.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          El catálogo no tiene campos habilitados.
          {puedeGestionar ? " Usa Administrar catálogo para agregarlos." : " Pide a quien gestiona el catálogo que los habilite."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {TABLAS.map((tabla) => {
            const grupo = visibles.filter((c) => c.tabla === tabla);
            if (grupo.length === 0) return null;
            const marcados = grupo.filter((c) => seleccion.has(c.id)).length;
            const estado =
              marcados === 0 ? false : marcados === grupo.length ? true : "indeterminate";
            return (
              <fieldset
                key={tabla}
                className="flex flex-col gap-2"
                disabled={disabled}
                // El recorrido resalta el primer grupo visible: la lista completa no cabe.
                data-tour={tabla === primerGrupo ? "campos" : undefined}
              >
                <legend className="flex w-full items-center gap-2 border-b border-border pb-1.5">
                  <Checkbox
                    checked={estado}
                    onCheckedChange={(v) => toggleGrupo(grupo.map((c) => c.id), v === true)}
                    aria-label={`Seleccionar todos: ${TABLA_LABEL[tabla]}`}
                  />
                  <span className="text-[11px] font-semibold uppercase leading-none tracking-[0.06em] text-muted-foreground">
                    {TABLA_LABEL[tabla]}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {marcados}/{grupo.length}
                  </span>
                </legend>
                <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 2xl:grid-cols-3">
                  {grupo.map((c) => (
                    <label
                      key={c.id}
                      className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={seleccion.has(c.id)}
                        onCheckedChange={(v) => toggle(c.id, v === true)}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={c.etiqueta}>
                        {c.etiqueta}
                      </span>
                      <span
                        className="max-w-[45%] truncate font-mono text-[11px] text-muted-foreground"
                        title={`${c.modo === "texto" ? "BUILTIN.DF(" : ""}${c.tabla}.${c.campo}${c.modo === "texto" ? ")" : ""} · ${TIPO_LABEL[c.tipo]}`}
                      >
                        {c.modo === "texto" ? `${c.campo} (nombre)` : c.campo}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
          {visibles.length === 0 && (
            <p className="text-sm text-muted-foreground">Ningún campo coincide con “{busqueda}”.</p>
          )}
        </div>
      )}

      <Dialog open={guardarComoOpen} onOpenChange={setGuardarComoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guardar plantilla</DialogTitle>
            <DialogDescription>
              Guarda los {seleccion.size} campos seleccionados
              {filtrosAGuardar().length > 0 &&
                ` y ${filtrosAGuardar().length === 1 ? "el filtro" : `los ${filtrosAGuardar().length} filtros`}`}{" "}
              con un nombre. Todo el equipo de ingresos la verá.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              guardarComo();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nombre-plantilla">Nombre</Label>
              <Input
                id="nombre-plantilla"
                autoFocus
                maxLength={80}
                placeholder="p. ej. Conciliación con terceros"
                value={nombreNueva}
                onChange={(e) => setNombreNueva(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setGuardarComoOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isPending || nombreNueva.trim().length < 2}>
                {isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={eliminarOpen} onOpenChange={setEliminarOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>¿Eliminar plantilla?</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a eliminar “{plantilla?.nombre}” para todo el equipo. Esta acción no se
              puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost" disabled={isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                eliminar();
              }}
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Eliminando…
                </>
              ) : (
                "Eliminar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {puedeGestionar && (
        <CatalogoSheet open={catalogoOpen} onOpenChange={setCatalogoOpen} campos={campos} />
      )}
    </section>
  );
}

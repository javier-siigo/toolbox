import { Skeleton } from "@/components/ui/skeleton";

// Esqueleto común de las páginas del portal. Con este archivo Next prefetchea el layout y el
// esqueleto de las rutas dinámicas, así que al hacer clic la navegación cambia al instante y
// el contenido llega por streaming cuando el servidor termina.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Cargando">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-4 w-2/3 max-w-xl" />
        <Skeleton className="h-9 w-36" />
      </div>
      <Skeleton className="h-[420px] rounded-xl" />
    </div>
  );
}

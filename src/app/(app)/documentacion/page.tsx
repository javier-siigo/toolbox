import { BookOpen } from "lucide-react";

import { EmptyState } from "@/components/common/empty-state";
import { IndiceDocumentacion } from "@/components/documentacion/indice";
import { PageTransition } from "@/components/motion/page-transition";
import { contextoDocumentacion } from "@/lib/documentacion/acceso";

export const metadata = {
  title: "Documentación",
};

export default async function DocumentacionPage() {
  const { accesibles } = await contextoDocumentacion();

  return (
    <PageTransition>
      <div className="flex flex-col gap-5">
        <header className="flex flex-col gap-2">
          <h1 className="text-base font-semibold tracking-tight text-foreground">Documentación</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Cómo funciona cada proceso del portal: qué hace, cómo se usa y con qué sistemas se
            conecta. Solo ves los documentos de los procesos a los que tienes acceso.
          </p>
        </header>

        {accesibles.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-6" aria-hidden />}
            title="No tienes documentos disponibles"
            description="Pide a un administrador acceso al proceso que necesitas consultar."
          />
        ) : (
          <IndiceDocumentacion
            items={accesibles.map((d) => ({
              slug: d.slug,
              titulo: d.titulo,
              descripcion: d.descripcion,
            }))}
          />
        )}
      </div>
    </PageTransition>
  );
}

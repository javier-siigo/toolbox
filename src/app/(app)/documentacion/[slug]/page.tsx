import { notFound } from "next/navigation";

import { DocumentoMarkdown } from "@/components/documentacion/markdown";
import { NavegacionDocumentos } from "@/components/documentacion/navegacion";
import { Toc } from "@/components/documentacion/toc";
import { PageTransition } from "@/components/motion/page-transition";
import { contextoDocumentacion, puedeDocumento } from "@/lib/documentacion/acceso";
import { anclasPorArchivo, cargarDocumento } from "@/lib/documentacion/contenido";
import { DOCUMENTOS, findDocumento } from "@/lib/documentacion/registry";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return DOCUMENTOS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const doc = findDocumento(slug);
  return { title: doc ? `${doc.titulo} · Documentación` : "Documentación" };
}

export default async function DocumentoPage({ params }: PageProps) {
  const { slug } = await params;
  const meta = findDocumento(slug);
  // Slug fuera del registro: 404 propio de la documentación (not-found.tsx).
  if (!meta) notFound();

  const { permisos, esAdmin, accesibles } = await contextoDocumentacion();
  if (!puedeDocumento(permisos, meta)) notFound();

  const [doc, mapa] = await Promise.all([
    cargarDocumento(meta, esAdmin),
    anclasPorArchivo(accesibles, esAdmin),
  ]);

  const indice = accesibles.findIndex((d) => d.slug === meta.slug);
  const anterior = indice > 0 ? accesibles[indice - 1] : undefined;
  const siguiente = indice >= 0 ? accesibles[indice + 1] : undefined;

  return (
    <PageTransition>
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <header className="flex flex-col gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground text-balance">
              {doc.titulo}
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">{meta.descripcion}</p>
          </header>

          <article className="min-w-0 rounded-lg border border-border bg-card px-5 py-6 shadow-sm sm:px-8 sm:py-8">
            <div className="max-w-[72ch]">
              <DocumentoMarkdown
                cuerpo={doc.cuerpo}
                archivo={meta.archivo}
                mapa={mapa}
                restringidas={doc.restringidas}
              />
            </div>
          </article>

          <NavegacionDocumentos anterior={anterior} siguiente={siguiente} />
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-6">
            <Toc entradas={doc.toc} />
          </div>
        </aside>
      </div>
    </PageTransition>
  );
}

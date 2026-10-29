import { notFound } from "next/navigation";

import { PageTransition } from "@/components/motion/page-transition";
import { EmptyState } from "@/components/common/empty-state";
import { requireAcceso, requireAdmin } from "@/lib/auth/acceso";
import { AREAS, findProceso } from "@/lib/navigation";

interface PageProps {
  params: Promise<{ area: string; proceso: string }>;
}

export function generateStaticParams() {
  return AREAS.flatMap((area) =>
    area.procesos.map((proceso) => ({ area: area.slug, proceso: proceso.slug })),
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { area, proceso } = await params;
  const proc = findProceso(area, proceso);
  return { title: proc ? proc.label : "Proceso" };
}

export default async function ProcesoPage({ params }: PageProps) {
  const { area, proceso } = await params;
  const procObj = findProceso(area, proceso);
  if (!procObj) notFound();

  // Procesos del menú que aún no tienen página propia (p. ej. Conciliación Chile).
  if (procObj.id) await requireAcceso(procObj.id);
  else await requireAdmin();

  return (
    <PageTransition>
      <EmptyState
        icon={<procObj.icon className="size-7" />}
        title="Este proceso aún no tiene contenido"
        description="Cuando el equipo configure los parámetros y permisos, aparecerán aquí los pasos a ejecutar."
      />
    </PageTransition>
  );
}
import { ConciliacionesPageClient } from "@/components/conciliaciones/conciliaciones-page";
import { PageTransition } from "@/components/motion/page-transition";
import { requireAcceso } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { getBancosPorPais } from "@/lib/conciliaciones/bancos";

export const metadata = {
  title: "Conciliación Ecuador",
};

export default async function ConciliacionPage() {
  const { nivel } = await requireAcceso(PROCESOS.CONCILIACION_ECUADOR);
  const bancos = await getBancosPorPais("EC");

  return (
    <PageTransition>
      <ConciliacionesPageClient pais="EC" bancos={bancos} soloLectura={nivel === "ver"} />
    </PageTransition>
  );
}

import { ConciliacionesPageClient } from "@/components/conciliaciones/conciliaciones-page";
import { PageTransition } from "@/components/motion/page-transition";
import { requireAcceso } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { getBancosPorPais } from "@/lib/conciliaciones/bancos";

export const metadata = {
  title: "Conciliación Uruguay",
};

export default async function ConciliacionPage() {
  const { nivel } = await requireAcceso(PROCESOS.CONCILIACION_URUGUAY);
  const bancos = await getBancosPorPais("UY");

  return (
    <PageTransition>
      <ConciliacionesPageClient pais="UY" bancos={bancos} soloLectura={nivel === "ver"} />
    </PageTransition>
  );
}

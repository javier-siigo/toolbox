import { ConciliacionesPageClient } from "@/components/conciliaciones/conciliaciones-page";
import { PageTransition } from "@/components/motion/page-transition";
import { requireAcceso } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { getBancosPorPais } from "@/lib/conciliaciones/bancos";

export const metadata = {
  title: "Conciliación México",
};

export default async function ConciliacionPage() {
  const { nivel } = await requireAcceso(PROCESOS.CONCILIACION_MEXICO);
  const bancos = await getBancosPorPais("MX");

  return (
    <PageTransition>
      <ConciliacionesPageClient pais="MX" bancos={bancos} soloLectura={nivel === "ver"} />
    </PageTransition>
  );
}

import { AsientosPageClient } from "@/components/conciliaciones/asientos/asientos-page";
import { PageTransition } from "@/components/motion/page-transition";
import { requireAcceso } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { getSubsidiariasSeguro } from "@/lib/conciliaciones/asientos";

export const metadata = {
  title: "Conciliación de asientos de diario",
};

export default async function AsientosDiarioPage() {
  const { nivel } = await requireAcceso(PROCESOS.CONCILIACION_ASIENTOS);
  const { subsidiarias, error } = await getSubsidiariasSeguro();

  return (
    <PageTransition>
      <AsientosPageClient
        subsidiarias={subsidiarias}
        errorSubsidiarias={error}
        soloLectura={nivel === "ver"}
      />
    </PageTransition>
  );
}

import { AnticiposPageClient } from "@/components/anticipos/anticipos-page";
import { PageTransition } from "@/components/motion/page-transition";
import { getAnticiposAll } from "@/lib/anticipos/actions";
import { requireAcceso } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";

export const metadata = {
  title: "Gestión y Legalización de Anticipos",
};

export default async function GestionAnticiposPage() {
  const { nivel } = await requireAcceso(PROCESOS.GESTION_ANTICIPOS);
  const rows = await getAnticiposAll();

  return (
    <PageTransition>
      <AnticiposPageClient rows={rows} soloLectura={nivel === "ver"} />
    </PageTransition>
  );
}

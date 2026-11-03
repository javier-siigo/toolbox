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

  // "Hoy" en Colombia, calculado aquí para que el semáforo no dependa del reloj del navegador
  // ni cambie entre el render del servidor y el del cliente.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());

  return (
    <PageTransition>
      <AnticiposPageClient rows={rows} hoy={hoy} soloLectura={nivel === "ver"} />
    </PageTransition>
  );
}

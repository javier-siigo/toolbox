import { Cartera1305Page } from "@/components/conciliaciones/cartera-1305/cartera-1305-page";
import { PageTransition } from "@/components/motion/page-transition";
import { requireAcceso } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { getSubsidiariasSeguro } from "@/lib/conciliaciones/asientos";

export const metadata = {
  title: "Conciliación 1305",
};

export default async function Cartera1305RoutePage() {
  await requireAcceso(PROCESOS.CONCILIACION_1305);
  const { subsidiarias, error } = await getSubsidiariasSeguro();

  return (
    <PageTransition>
      <Cartera1305Page subsidiarias={subsidiarias} errorSubsidiarias={error} />
    </PageTransition>
  );
}

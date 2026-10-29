import { NotasCreditoPageClient } from "@/components/notas-credito/notas-credito-page";
import { PageTransition } from "@/components/motion/page-transition";
import { requireAcceso } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";

export const metadata = {
  title: "Notas crédito",
};

export default async function NotasCreditoPage() {
  const { nivel } = await requireAcceso(PROCESOS.NOTAS_CREDITO);

  return (
    <PageTransition>
      <NotasCreditoPageClient soloLectura={nivel === "ver"} />
    </PageTransition>
  );
}

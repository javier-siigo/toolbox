import { PageTransition } from "@/components/motion/page-transition";
import { ServiciosPublicosPageClient } from "@/components/servicios-publicos/servicios-publicos-page";
import { requireAcceso } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { getServiciosPublicos, type DatosServiciosPublicos } from "@/lib/servicios-publicos/actions";

export const metadata = {
  title: "Servicios públicos",
};

export default async function ServiciosPublicosPage() {
  const { nivel } = await requireAcceso(PROCESOS.SERVICIOS_PUBLICOS);

  let data: DatosServiciosPublicos = { servicios: [], recibos: [] };
  let errorDatos: string | null = null;
  try {
    data = await getServiciosPublicos();
  } catch (err) {
    console.error("[servicios-publicos] carga", err);
    errorDatos = err instanceof Error ? err.message : "Error inesperado.";
  }

  // "Hoy" en Colombia, calculado aquí para que las alertas no dependan del reloj del navegador
  // ni cambien entre el render del servidor y el del cliente.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());

  return (
    <PageTransition>
      <ServiciosPublicosPageClient
        servicios={data.servicios}
        recibos={data.recibos}
        hoy={hoy}
        errorDatos={errorDatos}
        soloLectura={nivel === "ver"}
      />
    </PageTransition>
  );
}

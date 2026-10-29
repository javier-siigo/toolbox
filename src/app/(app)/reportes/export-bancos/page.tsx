import { ExportBancosPageClient } from "@/components/export-bancos/export-bancos-page";
import { PageTransition } from "@/components/motion/page-transition";
import { requireAcceso } from "@/lib/auth/acceso";
import { PROCESOS } from "@/lib/auth/permisos-shared";
import { getCamposData, type CamposData } from "@/lib/netsuite/campos-actions";
import { hoyIso, mesAnterior } from "@/lib/netsuite/rango-fechas";

// El descubrimiento de campos (server action) consulta NetSuite hasta ~50 s.
export const maxDuration = 60;

export const metadata = {
  title: "Auditoría Asientos de Diario",
};

export default async function ExportBancosPage() {
  const { nivel } = await requireAcceso(PROCESOS.EXPORT_BANCOS);

  let camposData: CamposData = { campos: [], plantillas: [] };
  let errorCampos: string | null = null;
  try {
    camposData = await getCamposData();
  } catch (err) {
    errorCampos = err instanceof Error ? err.message : "Error inesperado.";
  }

  return (
    <PageTransition>
      <ExportBancosPageClient
        rangoInicial={mesAnterior()}
        hoy={hoyIso()}
        campos={camposData.campos}
        plantillas={camposData.plantillas}
        nivel={nivel}
        errorCampos={errorCampos}
      />
    </PageTransition>
  );
}

import Link from "next/link";

import { ConsolaSuiteQL } from "@/components/admin-suiteql/consola-page";
import { PageTransition } from "@/components/motion/page-transition";
import { requireAdmin } from "@/lib/auth/acceso";

// "Todas" pagina hasta 25.000 filas contra NetSuite.
export const maxDuration = 300;

export const metadata = {
  title: "Consola SuiteQL",
};

export default async function AdminSuiteQLPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const queryInicial = typeof q === "string" ? q.slice(0, 50_000) : undefined;

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Consola SuiteQL
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Ejecuta queries de solo lectura contra NetSuite con la misma integración de SuiteTalk que
            usa el portal. Pega la query, elige cuántas filas traer y revisa el resultado como tabla o
            JSON. El{" "}
            <Link href="/documentacion/alcance-suitetalk" className="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary">
              alcance de SuiteTalk
            </Link>{" "}
            lista las tablas disponibles con ejemplos.
          </p>
        </header>

        <ConsolaSuiteQL queryInicial={queryInicial} />
      </div>
    </PageTransition>
  );
}

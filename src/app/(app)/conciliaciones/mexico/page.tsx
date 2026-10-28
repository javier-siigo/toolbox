import { redirect } from "next/navigation";

import { ConciliacionesPageClient } from "@/components/conciliaciones/conciliaciones-page";
import { PageTransition } from "@/components/motion/page-transition";
import { getBancosPorPais } from "@/lib/conciliaciones/bancos";
import { getUserRoles, requireProcesoAccess } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Conciliación México",
};

export default async function ConciliacionMexicoPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  const roles = await getUserRoles(data.claims.sub);
  await requireProcesoAccess(roles, "conciliaciones", {
    slug: "mexico",
    flagCode: "MX",
  });

  const bancos = await getBancosPorPais("MX");

  return (
    <PageTransition>
      <ConciliacionesPageClient pais="MX" bancos={bancos} />
    </PageTransition>
  );
}
import { AppShell } from "@/components/layout/app-shell";
import { requireSesion } from "@/lib/auth/acceso";

// Solo arma el menú con los permisos del usuario. No protege nada: los layouts no se
// re-ejecutan al navegar; cada página llama a `requireAcceso` (ver lib/auth/acceso.ts).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { nombre, email, permisos } = await requireSesion();

  return (
    <AppShell user={{ name: nombre, email }} permisos={permisos}>
      {children}
    </AppShell>
  );
}

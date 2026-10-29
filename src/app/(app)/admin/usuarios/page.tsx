import { UsuariosPage } from "@/components/admin-usuarios/usuarios-page";
import { PageTransition } from "@/components/motion/page-transition";
import { listUsuarios } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/auth/acceso";

export const metadata = {
  title: "Usuarios y permisos",
};

export default async function AdminUsuariosPage() {
  const { userId } = await requireAdmin();
  const users = await listUsuarios();

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Usuarios y permisos
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Decide a qué procesos entra cada persona y qué puede hacer en ellos:{" "}
            <strong>Ver</strong> consulta, <strong>Usar</strong> opera y{" "}
            <strong>Gestionar</strong> además configura. <strong>Admin</strong> tiene
            todo y administra esta pantalla.
          </p>
        </header>

        <UsuariosPage users={users} currentUserId={userId} />
      </div>
    </PageTransition>
  );
}

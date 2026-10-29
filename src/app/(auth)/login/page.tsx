import { Calculator } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { PageTransition } from "@/components/motion/page-transition";

export const metadata = {
  title: "Iniciar sesión",
};

export default function LoginPage() {
  return (
    <PageTransition>
      <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
        <div className="w-full max-w-[420px] space-y-8">
          <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
            <div className="space-y-8 p-8 sm:p-10">
              <header className="space-y-6">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Calculator className="h-4 w-4" />
                  </span>
                  <span className="font-mono text-sm font-semibold uppercase tracking-[0.14em]">
                    Toolbox
                  </span>
                </div>

                <div className="space-y-2">
                  <h1 className="text-2xl font-semibold tracking-tight">
                    Iniciar sesión
                  </h1>
                  <p className="text-sm text-muted-foreground">
                    Usa tu correo corporativo y la contraseña registrada en Supabase.
                  </p>
                </div>
              </header>

              <LoginForm />

              <p className="text-center text-xs text-muted-foreground">
                ¿Problemas para entrar? Contacta al administrador del portal.
              </p>
            </div>
          </div>

          <p className="text-center font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground/70">
            Acceso restringido · Equipo contable
          </p>
        </div>
      </main>
    </PageTransition>
  );
}

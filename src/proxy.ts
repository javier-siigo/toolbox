import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = new Set<string>(["/login"]);
// /api/cron se autentica con CRON_SECRET dentro de la ruta.
const PUBLIC_PREFIXES = ["/api/public", "/api/cron", "/_next", "/favicon", "/icons"];
const SEEN_COOKIE = "siico_seen";
const SEEN_INTERVAL_SECONDS = 5 * 60;

/**
 * Solo permite redirecciones internas. `from` viene del query string, así que
 * sin esta validación `?from=https://evil.com` o `?from=//evil.com` convertirían
 * /login en un open redirect phishing con la URL del portal como cobertura.
 */
function safeInternalPath(value: string | null): string {
  if (!value) return "/dashboard";
  // `new URL()` elimina tabuladores y saltos de línea antes de resolver, así que
  // "/\t/evil.com" se convertiría en "//evil.com" si no los quitamos antes.
  const path = value.replace(/[\t\n\r]/g, "");
  if (!path.startsWith("/")) return "/dashboard";
  if (path.startsWith("//")) return "/dashboard";
  if (path.startsWith("/\\")) return "/dashboard";
  return path;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const hasSession = Boolean(data?.claims?.sub);

  if (!hasSession && !PUBLIC_PATHS.has(pathname)) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (hasSession && pathname === "/login") {
    const next = safeInternalPath(
      request.nextUrl.searchParams.get("from"),
    );
    return NextResponse.redirect(new URL(next, request.url));
  }

  if (!hasSession && pathname === "/") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Última actividad para la pantalla de admin. La cookie evita ir a la BD en
  // cada request; la función además ignora llamadas a menos de 5 min.
  if (hasSession && !request.cookies.has(SEEN_COOKIE)) {
    try {
      await supabase.schema("core").rpc("touch_last_seen");
    } catch {
      // No bloquear la navegación por un registro de actividad.
    }
    response.cookies.set(SEEN_COOKIE, "1", {
      maxAge: SEEN_INTERVAL_SECONDS,
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
    });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
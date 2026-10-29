/**
 * Verifica que ningún punto de entrada se salte la capa de acceso (src/lib/auth/acceso.ts).
 * Corre con `npm run lint` (y `npm run check:acceso`). Falla con código 1 si encuentra algo.
 *
 *   1. Páginas de src/app/(app): deben llamar a requireAcceso / requireAdmin
 *      (salvo las de SOLO_SESION, que solo necesitan sesión y filtran por permisos).
 *   2. Archivos "use server": CADA función exportada debe llamar a autorizar / autorizarAdmin.
 *      Una server action es un endpoint público aunque ninguna página la use.
 *   3. Route handlers de src/app/api: deben autorizar (salvo RUTAS_PUBLICAS).
 *   4. Si hay credenciales en .env.local: los ids de PROCESOS existen en core.procesos.
 *
 * Las excepciones van en las listas de abajo, con su motivo. Agregar una debe ser una
 * decisión explícita en el code review, no un descuido.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const rel = (f) => path.relative(ROOT, f);

/** Páginas que no son un proceso: solo exigen sesión y muestran lo que el usuario puede ver. */
const SOLO_SESION = new Set([
  "src/app/(app)/dashboard/page.tsx",
  "src/app/(app)/documentacion/page.tsx", // contextoDocumentacion filtra por permisos
  "src/app/(app)/documentacion/[slug]/page.tsx", // ídem + 404 si no puede leer el documento
]);

/** Rutas sin sesión de usuario: se autentican con su propio secreto. */
const RUTAS_PUBLICAS = new Set([
  "src/app/api/cron/limpiar-storage/route.ts", // CRON_SECRET
]);

/** Server actions que por naturaleza no tienen sesión previa. */
const ACCIONES_PUBLICAS = new Set([
  "src/lib/auth/actions.ts:loginAction",
  "src/lib/auth/actions.ts:logoutAction",
]);

/**
 * Helpers que envuelven a `autorizar` y pueden usarse en su lugar en route handlers.
 * Cada uno se verifica abajo: su archivo debe llamar a autorizar.
 */
const HELPERS_DE_RUTA = {
  "leerSesion(": "src/lib/netsuite/peticion-bancos.ts",
  "leerPeticion(": "src/lib/netsuite/peticion-bancos.ts",
};

const GUARD_PAGINA = /\brequire(Acceso|Admin)\(/;
const GUARD_SESION = /\b(requireSesion|contextoDocumentacion)\(/;
const GUARD_ACCION = /\bautorizar(Admin)?\(/;

function archivos(dir, filtro) {
  const out = [];
  for (const nombre of readdirSync(dir)) {
    const f = path.join(dir, nombre);
    if (statSync(f).isDirectory()) out.push(...archivos(f, filtro));
    else if (filtro(f)) out.push(f);
  }
  return out;
}

const errores = [];

// 1. Páginas
for (const f of archivos(path.join(ROOT, "src/app/(app)"), (f) => f.endsWith("page.tsx"))) {
  const src = readFileSync(f, "utf8");
  const r = rel(f);
  if (SOLO_SESION.has(r)) {
    if (!GUARD_SESION.test(src) && !GUARD_PAGINA.test(src)) errores.push(`${r}: página sin requireSesion`);
  } else if (!GUARD_PAGINA.test(src)) {
    errores.push(`${r}: página sin requireAcceso(PROCESOS.X) ni requireAdmin()`);
  }
}

// 2. Server actions
for (const f of archivos(path.join(ROOT, "src"), (f) => /\.tsx?$/.test(f))) {
  const src = readFileSync(f, "utf8");
  if (!/^\s*["']use server["'];/.test(src)) continue;
  const partes = src.split(/\nexport async function /).slice(1);
  for (const parte of partes) {
    const nombre = parte.slice(0, parte.indexOf("("));
    if (ACCIONES_PUBLICAS.has(`${rel(f)}:${nombre}`)) continue;
    // El cuerpo de esta función llega hasta la siguiente declaración de nivel superior.
    const cuerpo = parte.split(/\n(?:export |async function |function |const |type |interface )/)[0];
    if (!GUARD_ACCION.test(cuerpo)) errores.push(`${rel(f)}: server action ${nombre}() sin autorizar()`);
  }
}

// 3. Route handlers
for (const [helper, archivo] of Object.entries(HELPERS_DE_RUTA)) {
  if (!GUARD_ACCION.test(readFileSync(path.join(ROOT, archivo), "utf8"))) {
    errores.push(`${archivo}: ${helper.slice(0, -1)} debería llamar a autorizar()`);
  }
}
for (const f of archivos(path.join(ROOT, "src/app/api"), (f) => /route\.tsx?$/.test(f))) {
  const r = rel(f);
  if (RUTAS_PUBLICAS.has(r)) continue;
  const src = readFileSync(f, "utf8");
  const usaHelper = Object.keys(HELPERS_DE_RUTA).some((h) => src.includes(h));
  if (!GUARD_ACCION.test(src) && !usaHelper) errores.push(`${r}: ruta sin autorizar()`);
}

// 4. Catálogo de procesos (solo si hay credenciales; en CI sin secretos se omite)
async function verificarCatalogo() {
  try {
    const { config } = await import("dotenv");
    config({ path: path.join(ROOT, ".env.local"), quiet: true });
  } catch {
    // dotenv es opcional para este paso
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("· catálogo de procesos: omitido (sin credenciales)");
    return;
  }
  const shared = readFileSync(path.join(ROOT, "src/lib/auth/permisos-shared.ts"), "utf8");
  const bloque = shared.slice(shared.indexOf("export const PROCESOS"), shared.indexOf("} as const"));
  const enCodigo = [...bloque.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
  const res = await fetch(`${url}/rest/v1/procesos?select=id`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "core" },
  });
  if (!res.ok) {
    errores.push(`core.procesos: no se pudo leer (${res.status})`);
    return;
  }
  const enBd = new Set((await res.json()).map((r) => r.id));
  for (const id of enCodigo) if (!enBd.has(id)) errores.push(`PROCESOS: "${id}" no existe en core.procesos (falta la migración)`);
  for (const id of enBd) if (!enCodigo.includes(id)) errores.push(`core.procesos: "${id}" no está en PROCESOS (permisos-shared.ts)`);
}

await verificarCatalogo();

if (errores.length > 0) {
  console.error(`✗ check:acceso — ${errores.length} problema(s):\n`);
  for (const e of errores) console.error(`  - ${e}`);
  console.error("\nVer src/lib/auth/acceso.ts para el patrón a usar.");
  process.exit(1);
}
console.log("✓ check:acceso — páginas, server actions y rutas pasan por la capa de acceso");

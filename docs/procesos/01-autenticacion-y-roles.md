# Autenticación, permisos y administración de usuarios

## Qué hace

Controla quién entra al portal y a qué procesos accede. Tiene tres piezas:

1. **Login/logout** con correo y contraseña (Supabase Auth).
2. **Permisos por proceso** (tablas `core.permisos` y `core.usuarios`): qué procesos abre cada persona y con qué nivel.
3. **Pantalla de administración** (`/admin/usuarios`) para asignarlos.

## Conexiones

| Conexión | Detalle |
|---|---|
| Supabase Auth | `signInWithPassword`, `signOut`, `getClaims()`, `auth.admin.listUsers` |
| Supabase BD | `core.usuarios`, `core.permisos`, `core.procesos` (vía cliente admin); RLS con `private.tiene_acceso` |
| n8n / APIs externas | Ninguna |

## Login

**Archivos:** `src/lib/auth/actions.ts`, `src/components/auth/login-form.tsx`, `src/app/(auth)/login/page.tsx`

1. `loginAction` (Server Action) valida con zod: correo válido y contraseña de **mínimo 8 caracteres**.
2. Llama a `supabase.auth.signInWithPassword`.
3. Si falla, traduce el error:

| Código Supabase | Mensaje |
|---|---|
| `invalid_credentials` | "Credenciales incorrectas" |
| `email_not_confirmed` | "Tu correo aún no ha sido confirmado" |
| `over_email_send_rate_limit` o HTTP 429 | "Demasiados intentos. Intenta de nuevo en unos minutos." |
| HTTP ≥ 500 | "El servicio de autenticación no está disponible…" |

4. Si funciona, la sesión queda en cookies `httpOnly` y la acción devuelve `success: true`; el formulario navega con `router.push("/dashboard")`. Si una persona ya autenticada abre `/login`, `proxy.ts` la redirige a `from` (si existe) o a `/dashboard`.

`logoutAction` cierra sesión y siempre responde éxito (aunque la sesión ya fuera inválida).

> No hay registro ni recuperación de contraseña en el portal: los usuarios se crean desde Supabase (**Authentication → Users → Add user**).

## Protección de rutas (`src/proxy.ts`)

En Next 16 reemplaza a `middleware.ts`. Para cada request:

- Rutas públicas: `/login` y los prefijos `/api/public`, `/_next`, `/favicon`, `/icons`.
- Crea un cliente Supabase con las cookies del request y llama `getClaims()`, que valida el JWT y refresca tokens vencidos.
- Sin sesión y ruta no pública → redirige a `/login?from=<ruta>`.
- Con sesión en `/login` → redirige a `from` o `/dashboard`.
- Sin sesión en `/` → `/login`.

El layout `(app)/layout.tsx` lee la sesión (`requireSesion`) para armar el nombre visible y el menú. **No protege nada**: los layouts no se re-ejecutan al navegar ni cubren server actions; cada página, action y ruta se autoriza sola (ver abajo).

## Permisos por proceso

**Archivos:** `src/lib/auth/permisos-shared.ts` (catálogo `PROCESOS`, niveles y decisiones puras; usable en cliente) y `src/lib/auth/acceso.ts` (capa de acceso, solo servidor).

Cada proceso tiene un id estable (`ingresos.gestion-anticipos`, `conciliaciones.colombia`…) que existe en `core.procesos` y en `PROCESOS`. Un usuario tiene, por proceso, uno de tres niveles (cada uno incluye al anterior):

| Nivel | Puede |
|---|---|
| `ver` | Consultar y exportar. La UI oculta o deshabilita crear, editar, ejecutar e importar |
| `usar` | Operar el proceso: crear, editar, legalizar, ejecutar conciliaciones, guardar cierres, plantillas |
| `gestionar` | Además, configurarlo (hoy: catálogo de campos NetSuite en Auditoría Asientos de Diario) |

**Admin** (`core.usuarios.es_admin`) tiene `gestionar` en todo y administra usuarios. Los países de conciliación son procesos: acceso a México = `conciliaciones.mexico`.

Los permisos se leen con el cliente admin y se **cachean 60 s** (`unstable_cache`, tag `permisos`); guardar desde la pantalla de admin invalida la caché.

### Capa de acceso: el único guard

| Punto de entrada | Llamada | Sin acceso |
|---|---|---|
| Página de proceso | `const { nivel } = await requireAcceso(PROCESOS.X)` | 404 (`/login` sin sesión) |
| Página de admin | `await requireAdmin()` | 404 |
| Server action | `const a = await autorizar(PROCESOS.X, "usar"); if (!a.ok) return { error: a.error }` | Error en el resultado |
| Route handler | igual que la action + `return respuestaDenegada(a)` | JSON 401/403 |

Las APIs de conciliaciones resuelven el proceso con el `pais` del body (`CONCILIACION_POR_PAIS`). La página pasa `soloLectura={nivel === "ver"}` al componente cliente.

RLS repite la regla en la BD con `private.tiene_acceso(proceso, nivel)`: `SELECT` con `ver`, escrituras con `usar` (o `gestionar` para configuración).

**`npm run lint` corre `scripts/check-acceso.mjs`**, que falla si una página no llama a `requireAcceso`/`requireAdmin`, si una función exportada de un archivo `"use server"` no llama a `autorizar`, si un route handler no autoriza, o si los ids de `PROCESOS` no coinciden con `core.procesos`. Las excepciones (login/logout, cron, Inicio, Documentación) están listadas en el script con su motivo.

### Agregar un proceso

1. Migración: `insert into core.procesos (id, area, nombre) values ('area.slug', …)` y políticas RLS con `private.tiene_acceso('area.slug', …)`.
2. Agregar el id a `PROCESOS` y `id: PROCESOS.X` en su entrada de `src/lib/navigation.ts`.
3. Página con `requireAcceso`, actions con `autorizar`. `npm run lint` avisa si falta algo.
4. Dar acceso desde `/admin/usuarios`.

### Dashboard (`/dashboard`)

Muestra, por área, la lista de procesos accesibles (con bandera si es de país). Sin permisos muestra "Aún no tienes procesos asignados".

### Catálogo (`src/lib/navigation.ts`)

Define las áreas (`conciliaciones`, `ingresos`, `admin`) y sus procesos. **Agregar un proceso al menú = agregarlo aquí.** Chile y México están declarados pero no tienen página propia: caen en `[area]/[proceso]`, que muestra "Este proceso aún no tiene contenido".

## Administración de usuarios (`/admin/usuarios`)

Solo admins (`requireAdmin`). Por usuario: el flag de administrador y, por área, un selector —/Ver/Usar/Gestionar por proceso más un atajo para toda el área. Muestra la vista previa de lo que verá en el portal y el diff antes de guardar.

**Archivo:** `src/lib/admin/users.ts`.

- `listUsuarios()`: une `auth.users` (paginando de a 200) con `core.usuarios`, `core.permisos` y `core.user_activity`. Las FK con `on delete cascade` evitan registros huérfanos.
- `updatePermisos({ userId, esAdmin, procesos })`: valida con zod, impide que un admin se quite su propio acceso y llama a `core.guardar_permisos` (RPC atómica, solo service role) que reemplaza todos los permisos del usuario. Invalida la caché con `revalidateTag("permisos")`.

## Base de datos

| Tabla / función | Contenido |
|---|---|
| `core.procesos` | Catálogo: `id`, `area`, `nombre`, `pais` (solo conciliaciones), `activo`. Lectura para `authenticated` |
| `core.permisos` | `(user_id, proceso_id)` PK, `nivel` (`ver`/`usar`/`gestionar`), `otorgado_por`, `otorgado_at`. Solo service role |
| `core.usuarios` | `user_id`, `es_admin`. Solo service role |
| `private.tiene_acceso(proceso, nivel)` | Usada por todas las políticas RLS. `security definer`, no expuesta en la API |
| `core.guardar_permisos(...)` | Guardado atómico desde la pantalla de admin. Solo service role |

Migraciones: `20261029160000_permisos_por_proceso.sql` (modelo, traducción de los roles anteriores y RLS) y `20261029170000_guardar_permisos.sql`.

## Hallazgos

- Un usuario nuevo no ve nada hasta que un admin le dé acceso a un proceso; es el comportamiento esperado.
- Los permisos se cachean 60 s; guardar desde la pantalla de admin invalida la caché, así que el cambio se ve de inmediato.

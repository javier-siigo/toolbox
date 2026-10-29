# Autenticación, roles y administración de usuarios

## Qué hace

Controla quién entra al portal y a qué procesos accede. Tiene tres piezas:

1. **Login/logout** con correo y contraseña (Supabase Auth).
2. **Roles y países** por usuario (tabla `core.user_roles`), que determinan qué áreas y procesos ve cada persona.
3. **Pantalla de administración** (`/admin/usuarios`) para asignar roles.

## Conexiones

| Conexión | Detalle |
|---|---|
| Supabase Auth | `signInWithPassword`, `signOut`, `getClaims()`, `auth.admin.listUsers` |
| Supabase BD | Tabla `core.user_roles` (vía cliente admin) |
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

El layout `(app)/layout.tsx` repite la comprobación, arma el nombre visible (`user_metadata.name` o la parte local del correo) y carga los roles para el sidebar.

## Roles

**Archivos:** `src/lib/auth/roles-shared.ts` (lógica pura, usable en cliente) y `src/lib/auth/roles.ts` (acceso a BD, solo servidor).

Roles válidos: `admin`, `conciliaciones`, `ingresos`. Países válidos: `CO`, `MX`, `UY`, `CL`, `EC`.

Se leen de `core.user_roles` (`roles text[]`, `paises text[]`) con el cliente admin y se **cachean 60 s** (`unstable_cache`, tag `user-roles`). Si el usuario no tiene fila, no tiene ningún rol.

### Matriz de acceso

| Rol | Conciliaciones | Ingresos | Administración |
|---|---|---|---|
| `admin` | Todos los países | Sí | Sí |
| `conciliaciones` | Solo los países asignados en `paises` | No | No |
| `ingresos` | No | Sí | No |
| (sin rol) | No | No | No |

Funciones clave:

- `canAccessArea(info, area)`, `canAccessProceso(info, area, proceso)`: aplican la matriz. En conciliaciones se compara `proceso.flagCode` (p. ej. `CO`) con `paises`.
- `filterAreas(info, AREAS)`: devuelve solo las áreas/procesos visibles. Lo usan el **sidebar** y el **dashboard**.
- `requireProcesoAccess(...)`: llama a `notFound()` (404) si no hay acceso. Lo usan las páginas de conciliaciones y el placeholder `[area]/[proceso]`.
- `requireAdmin(...)`: 404 si no es admin.

### Dashboard (`/dashboard`)

Muestra, por área, la lista de procesos accesibles (con bandera si es de país). Sin roles asignados muestra "Aún no tienes procesos asignados".

### Catálogo (`src/lib/navigation.ts`)

Define las áreas (`conciliaciones`, `ingresos`, `admin`) y sus procesos. **Agregar un proceso al menú = agregarlo aquí.** Chile y México están declarados pero no tienen página propia: caen en `[area]/[proceso]`, que muestra "Este proceso aún no tiene contenido".

## Administración de usuarios (`/admin/usuarios`)

**Archivos:** `src/lib/admin/users.ts`, `src/app/(app)/admin/usuarios/{page,users-table}.tsx`

- `listUsersWithRoles()`: solo admins. Une `core.user_roles` con todos los usuarios de `auth.users` (paginando de a 200 con `auth.admin.listUsers`). Los registros de `core.user_roles` sin usuario en Auth aparecen como **"(usuario huérfano)"**. Orden alfabético por correo. Incluye `last_sign_in_at`.
- `updateUserRoles({userId, roles, paises})`: solo admins. Valida con zod (UUID, roles y países del catálogo). **Los países solo se guardan si el rol `conciliaciones` está marcado**; de lo contrario se guardan vacíos. Hace `upsert` por `user_id` y llama `revalidateTag("user-roles")` para que el cambio sea inmediato.
- `requireCurrentAdmin()`: sin sesión → `/login`; sin rol admin → `/`.

## Base de datos

| Tabla | Columnas | Notas |
|---|---|---|
| `core.user_roles` | `user_id` (PK), `roles text[]`, `paises text[]`, `updated_at` | Escrita solo con service role |

La función SQL `public.current_user_has_role(text)` (usada por las políticas RLS de comisiones) **no está en las migraciones del repo**.

## Hallazgos

- Un usuario nuevo no ve nada hasta que un admin le asigne roles; es el comportamiento esperado.
- Los roles se cachean 60 s; `updateUserRoles` invalida la caché con `revalidateTag`, por lo que el cambio debería verse de inmediato.
- Las páginas `ingresos/*` no verifican rol en servidor (ver [00](00-arquitectura-general.md#10-hallazgos-transversales)).

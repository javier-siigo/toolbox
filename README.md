# Toolbox · Portal de automatizaciones contables

Portal interno para que el equipo contable de Siigo opere y supervise las
automatizaciones expuestas vía **n8n**, con autenticación gestionada por
**Supabase**.

> Fase 1 — scaffold: autenticación, layout con sidebar y topbar, páginas
> navegables con placeholders. Las colecciones y modelos de datos se definirán
> en fases posteriores.

----

## Stack

- **Next.js 16** (App Router, `src/`, TypeScript estricto)
- **Tailwind CSS v4** + **shadcn/ui** + **lucide-react**
- **next-themes** (claro/oscuro/sistema)
- **Supabase** (Auth SSR con `@supabase/ssr`, cookie httpOnly administrada por la librería)
- **n8n** como orquestador, accesible únicamente desde el servidor
- **zod** + **react-hook-form** para validación

---

## Requisitos

- Node.js 22.18+
- Un proyecto de [Supabase](https://supabase.com) (Cloud o self-hosted)

---

## Entorno de desarrollo

El proyecto está pensado para ejecutarse en **WSL** (Ubuntu 22.04+). Usar Node
desde Windows provoca problemas de rutas UNC con Turbopack.

### Instalar Node en WSL con nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
\. "$HOME/.nvm/nvm.sh"
nvm install 22.18.0
nvm alias default 22.18.0
```

> Cierra y abre la terminal, o agrega el bloque de carga de nvm a tu
> `~/.bashrc` si aún no está.

Verifica:

```bash
node --version   # v22.18.0
npm --version    # 10.x
```

---

## Configuración

### 1. Instalar dependencias

```bash
npm install
```

### 2. Crear el archivo `.env.local`

Copia `.env.example` y completa los valores:

```bash
cp .env.example .env.local
```

Variables:

| Variable | Tipo | Descripción |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | pública | URL del proyecto Supabase (`https://<project-ref>.supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | pública | Anon / publishable key del proyecto. Se envía al navegador. |
| `N8N_BASE_URL` | servidor | URL base del servidor n8n. |
| `N8N_WEBHOOK_SECRET` | servidor | Secreto compartido con n8n para autenticar webhooks. |
| `NETSUITE_ACCOUNT_ID` | servidor | ID de la cuenta NetSuite (`6389340`). |
| `NETSUITE_CONSUMER_KEY` | servidor | Consumer key de la integración OAuth 2.0 (M2M). |
| `NETSUITE_CERT_ID` | servidor | ID del certificado cargado en NetSuite (`kid` del JWT). |
| `NETSUITE_PRIVATE_KEY` | servidor | Clave privada PEM PKCS#8; puede ir en una sola línea. |
| `EXPORTS_BUCKET` | servidor | Bucket privado de Storage para los Excel generados (default `exports`). |

### 3. Configurar Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard).
2. En **Project Settings → API**, copia la **Project URL** y la **anon / publishable key** a `.env.local`.
3. En **Authentication → Providers**, confirma que **Email** está habilitado.
4. Crea al menos un usuario de prueba desde **Authentication → Users → Add user** con email y contraseña.

### 4. Levantar el servidor de desarrollo

```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000). Sin sesión activa serás
redirigido a `/login`.

---

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo con Turbopack (puerto 3000). |
| `npm run build` | Build de producción. |
| `npm run start` | Inicia el build de producción. |
| `npm run lint` | Ejecuta ESLint sobre `src/`. |
| `npm run typecheck` | Ejecuta `tsc --noEmit`. |

---

## Estructura

```
src/
├── app/
│   ├── (auth)/login/         Página de login
│   ├── (app)/                Rutas protegidas con sidebar y topbar
│   │   ├── dashboard/
│   │   ├── automations/
│   │   ├── executions/
│   │   └── settings/
│   ├── layout.tsx            Root layout (fuentes, tema, toaster)
│   └── globals.css           Tailwind v4 + tokens
├── components/
│   ├── ui/                   shadcn primitives
│   ├── layout/               Sidebar, topbar, menús
│   ├── auth/                 Formulario de login
│   ├── dashboard/            KPI tiles
│   └── common/               Page header, empty state
├── lib/
│   ├── supabase/server.ts    Cliente SSR (Server Components, Server Actions)
│   ├── supabase/client.ts    Cliente browser
│   ├── auth/                 Server actions (login/logout)
│   ├── env.ts                Validación zod de variables de entorno
│   └── n8n.ts                Cliente HTTP seguro para n8n
└── proxy.ts                  Refresh de tokens Supabase + protección de rutas (Next 16)
```

---

## Seguridad

- `N8N_WEBHOOK_SECRET` **nunca** sale al cliente.
- La sesión de Supabase se almacena en cookies `httpOnly` administradas por `@supabase/ssr`.
- Todas las llamadas a n8n pasan por `lib/n8n.ts`, que añade el secreto desde
  el entorno del servidor.
- El `proxy.ts` (Next.js 16, antes `middleware.ts`) llama a
  `supabase.auth.getClaims()` para validar el JWT y refrescar tokens expirados
  en cada request a rutas protegidas.

---

## Próximos pasos

1. Definir las tablas de Supabase (catálogo de automatizaciones, ejecuciones, permisos).
2. Implementar el Route Handler que dispara automatizaciones vía n8n.
3. Reemplazar los placeholders de `/dashboard`, `/automations` y
   `/executions` con datos reales.
4. Añadir la edición de perfil en `/settings`.

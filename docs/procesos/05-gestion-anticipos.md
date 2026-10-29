# Gestión y legalización de anticipos

## Qué hace

Registro y seguimiento de **anticipos pendientes de legalizar**, por colaborador y requerimiento (RQ). Cada registro indica **qué falta** para legalizarlo, el estado de la gestión de cobro/contacto y las fechas. Además **cruza automáticamente cada nombre con el reporte de excolaboradores** (ver [06](06-importacion-retirados.md)) para marcar quién ya se retiró de la empresa y cuánto valor tiene pendiente.

## Acceso

Ruta `/ingresos/gestion-anticipos`, proceso `ingresos.gestion-anticipos`. La página exige acceso (`requireAcceso`); leer pide `ver` y crear, editar, legalizar, borrar o importar piden `usar`, tanto en las server actions como en RLS (`20261029160000_permisos_por_proceso.sql`). Con `ver` la tabla se muestra sin acciones.

## Conexiones

| Conexión | Uso |
|---|---|
| Supabase BD (sesión del usuario) | CRUD sobre `anticipos.registros`; RPC `anticipos.match_colaborador_retirado_batch` |
| Supabase BD (service role) | Solo en la importación de retirados |
| n8n / APIs externas | **Ninguna** |

## Modelo de datos

Tabla `anticipos.registros`:

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | uuid | PK |
| `nombre` | texto (2–120) | Colaborador |
| `requerimiento` | texto (1–120) | RQ asociado |
| `falta` | enum `anticipos_falta_enum` | Qué falta para legalizar |
| `observacion_1` | enum `anticipos_observacion_1_enum` | Estado de la gestión de contacto |
| `observacion_2` | texto (≤ 500), opcional | Nota libre |
| `fecha_rq` | fecha `YYYY-MM-DD` | Fecha del requerimiento |
| `fecha_gestion` | fecha, opcional | Fecha de la última gestión |
| `nombre_normalizado` | generada | Nombre sin tildes/mayúsculas, tokens ordenados |
| `created_at/by`, `updated_at/by` | | Auditoría |

Existe una restricción de **unicidad** por colaborador + requerimiento (el código maneja el error `23505` con el mensaje "Ya existe un registro para este colaborador y requerimiento").

### Valores de `falta`

| Valor | Etiqueta |
|---|---|
| `permisos_de_soportes` | Permisos de soportes |
| `revisar_descuento_nomina` | Revisar descuento de nómina |
| `autorizacion_descuento_nomina` | Autorización descuento de nómina |
| `legalizado` | Legalizado |
| `revisar_soportes` | Revisar soportes |
| `devolucion` | Devolución |
| `autorizacion_soportes` | Autorización soportes |
| `revisar_con_harold` | Revisar con Harold |
| `soportes` | Soportes |

### Valores de `observacion_1`

`no_se_ha_contactado` (No se ha contactado) · `escrito_1_vez` · `escrito_2_veces` · `escrito_3_veces` · `correo_al_lider` (Correo al líder) · `legalizado`.

## Operaciones (Server Actions, `src/lib/anticipos/actions.ts`)

Todas exigen sesión (`auth.getUser`) y validan con zod (`schema.ts`). Tras escribir, `revalidatePath("/ingresos/gestion-anticipos")`.

| Acción | Qué hace |
|---|---|
| `getAnticiposAll()` | Lee hasta **1.000** registros (`MAX_ANTICIPOS_ROWS`), más recientes primero. Llama **una sola vez** a la RPC `anticipos.match_colaborador_retirado_batch` con todos los nombres y adjunta a cada fila `es_retirado` y `retiro_info` (cédula, nombre en el reporte, valor, observación, fecha de reporte, nivel de coincidencia, tokens comunes/extra) |
| `createAnticipo` | Valida formulario, inserta con `created_by/updated_by` = usuario. Duplicado → error de campo |
| `updateAnticipo` | Actualiza todos los campos editables; fija `updated_by` |
| `deleteAnticipo(id)` | Elimina por UUID |
| `legalizeAnticipo(id)` | Atajo: pone `falta = legalizado` y `observacion_1 = legalizado` |

Validaciones: `fecha_rq` debe ser una fecha válida; `fecha_gestion` puede ir vacía (se guarda `null`).

## Interfaz

`src/components/anticipos/`

- **Indicadores** calculados en el cliente sobre las filas: *pendientes* (`falta ≠ legalizado`), *devoluciones* (`falta = devolucion`), *legalizados*, *excolaboradores* y **valor total** de los retirados que siguen pendientes (`Σ retiro_info.valor`).
- **Tabla** (TanStack Table) con búsqueda global, filtros por `falta` y `observacion_1`, filtro **"solo retirados"**, paginación en el cliente (5 por defecto; opciones 5, 10, 20, 50, 100), texto truncado con tooltip y marca visual de excolaborador con detalle de la coincidencia.
- **Formulario de alta** y **hoja lateral de edición**; **diálogo de confirmación** para eliminar.
- Estado optimista local (`added`, `legalized`) para reflejar cambios antes de recargar.
- Botón que abre la hoja **Importar excolaboradores** (ver [06](06-importacion-retirados.md)).

## Cruce con excolaboradores

Lo hace la función SQL `anticipos.match_colaborador_retirado_batch` (migración `20261016130000`):

1. **Normaliza** nombres: minúsculas, sin tildes (`á→a`, `ñ→n`), sin símbolos, separa en tokens.
2. Compara contra `anticipos.retirados.nombre`. Un candidato es válido si **todos los tokens del nombre buscado están en el del reporte**.
3. Clasifica el **nivel**: `exacto` (mismos tokens en el mismo orden) → `exacto_inverso` (orden "apellido nombre") → `parcial`.
4. Por cada nombre consultado conserva el **mejor candidato** (`row_number`): primero el nivel, luego el que tenga **menos tokens extra** (segundo nombre/apellido), luego la cédula menor.

El resultado incluye `tokens_comunes` y `tokens_extra` para que el usuario pueda **desambiguar** coincidencias parciales.

## Archivos fuente

- Página: `src/app/(app)/ingresos/gestion-anticipos/page.tsx`
- UI: `src/components/anticipos/` (`anticipos-page`, `anticipos-data-table`, `columns`, `anticipos-form`, `anticipos-edit-sheet`, `anticipos-delete-dialog`, `data-table-features`, `truncated-text`, `importar-retirados/`)
- Lógica: `src/lib/anticipos/{actions,schema,format}.ts`
- SQL: `supabase/migrations/20261016120000_match_colaborador_retirado.sql`, `…130000_match_colaborador_retirado_batch.sql`

## Hallazgos

1. **Límite silencioso de 1.000 registros**: si se supera, los más antiguos dejan de verse.
2. Cada carga ejecuta el cruce de **todos** los nombres contra todos los retirados; escalará mal si crecen los datos.
3. Si la RPC falla, **toda la página falla** (lanza excepción) en lugar de mostrar los anticipos sin el cruce.
4. Una coincidencia `parcial` puede ser un falso positivo (homónimos): el campo `es_retirado` es `true` para cualquier nivel, incluida la coincidencia parcial.
5. El enum `revisar_con_harold` contiene un nombre propio; un cambio de responsable exige migración.
6. Migración de la tabla, enums y políticas no versionadas en el repo.

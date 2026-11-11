# Gestión y legalización de anticipos

## Qué hace

Registro y seguimiento de **anticipos pendientes de legalizar**, por colaborador y requerimiento (RQ). Cada registro indica **qué falta** para legalizarlo, el estado de la gestión de cobro/contacto y las fechas. Además **cruza automáticamente cada nombre con el reporte de excolaboradores** (ver [06](06-importacion-retirados.md)) para marcar quién ya se retiró de la empresa y cuánto valor tiene pendiente.

## Acceso

Ruta `/ingresos-egresos/gestion-anticipos`, proceso `ingresos.gestion-anticipos`. La página exige acceso (`requireAcceso`); leer pide `ver` y crear, editar, legalizar, borrar o importar piden `usar`, tanto en las server actions como en RLS (`20261029160000_permisos_por_proceso.sql`). Con `ver` la tabla y el detalle se muestran sin acciones.

## Conexiones

| Conexión | Uso |
|---|---|
| Supabase BD (sesión del usuario) | CRUD sobre `anticipos.registros` (el cruce con excolaboradores lo hacen triggers en la BD) |
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
| `valor` | numeric(14,0) ≥ 0, opcional | Valor del anticipo en pesos (migración `20261103120000`). El formulario acepta `1500000`, `1.500.000` o `$ 1.500.000` |
| `fecha_rq` | fecha `YYYY-MM-DD` | **Fecha final** del anticipo (en la UI se llama así; la columna conserva el nombre). La **fecha máxima de legalización** no se guarda: es `fecha_rq + 8` días corridos (`fechaMaximaLegalizacion`). |
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

Todas exigen sesión (`auth.getUser`) y validan con zod (`schema.ts`). Tras escribir, `revalidatePath("/ingresos-egresos/gestion-anticipos")`.

| Acción | Qué hace |
|---|---|
| `getAnticiposAll()` | Lee hasta **1.000** registros (`MAX_ANTICIPOS_ROWS`), más recientes primero. Una sola consulta: el cruce ya está guardado en cada registro, y los datos del excolaborador (cédula, nombre en el reporte, valor, observación, fecha de reporte) llegan por la FK `retiro_cedula`. Arma `es_retirado` y `retiro_info` (con nivel de coincidencia y tokens comunes/extra) |
| `createAnticipo` | Valida formulario, inserta con `created_by/updated_by` = usuario. Duplicado → error de campo |
| `updateAnticipo` | Actualiza todos los campos editables; fija `updated_by` |
| `deleteAnticipo(id)` | Elimina por UUID |
| `legalizeAnticipo(id)` | Atajo: pone `falta = legalizado` y `observacion_1 = legalizado` |

Validaciones: `fecha_rq` debe ser una fecha válida; `fecha_gestion` puede ir vacía (se guarda `null`).

## Interfaz

`src/components/anticipos/` — mismo esquema que [Servicios públicos](07-servicios-publicos.md) (reusa `Indicador`, `FiltroSelect` y `AlertaIndicador` de `servicios-publicos/bits.tsx`).

- **Semáforo** (`src/lib/anticipos/seguimiento.ts`, única fuente de la regla): *Resuelto* (legalizado o con fecha de gestión), *En plazo* (hoy ≤ fecha máxima de legalización) y *Vencido* (pasó la fecha máxima; muestra "Vencido N días"). Ej.: fecha final 1 nov → máxima 9 nov → el 11 nov está vencido 2 días. "Hoy" lo calcula el servidor en hora de Colombia. Lo usan la tabla, los indicadores, el detalle y el Excel.
- **Indicadores** clicables (filtran la tabla): vencidos, sin resolver (con su valor), devoluciones, legalizados (% del total) y excolaboradores (valor pendiente según el reporte de Contabilidad).
- **Tabla** (`anticipos-tabla.tsx`) ordenada por semáforo por defecto (vencidos primero, el más antiguo arriba); clic en un encabezado ordena asc → desc → por defecto. Las columnas se reparten el ancho disponible (`table-fixed`, sin scroll horizontal desde 720 px) y se ajustan arrastrando el borde del encabezado o con las flechas; el ancho se guarda en `localStorage` y doble clic lo restablece. Tabla con búsqueda y filtros por seguimiento, falta, observación 1 y tipo de colaborador. Pinta 50 filas y "Mostrar más". El pie muestra el conteo y el valor total de lo filtrado. "Legalizar" al final de cada fila pendiente.
- **Panel lateral** (`anticipo-sheet.tsx`): al hacer clic en una fila muestra el detalle (datos, observación 2 y el reporte de Contabilidad si es excolaborador) con Legalizar / Editar / Eliminar. *Editar* cambia el mismo panel al formulario; *Nuevo registro* también abre en el panel.
- **Descargar Excel** con las filas filtradas, en el orden de la tabla.
- Botón **Importar/Actualizar retirados** (ver [06](06-importacion-retirados.md)).

## Cruce con excolaboradores

El resultado se **guarda en el registro** (migración `20261029190000`): `retiro_cedula` (FK a `anticipos.retirados`), `retiro_nivel`, `retiro_tokens_comunes`, `retiro_tokens_extra` y `es_retirado` (generada: `retiro_cedula is not null`). La página no cruza nada al cargar; se recalcula solo cuando algo lo puede cambiar:

| Evento | Trigger | Alcance |
|---|---|---|
| Insertar un registro o cambiarle el `nombre` | `registros_marcar_retiro` (before, por fila) → `anticipos.match_colaborador_retirado` | Solo ese registro |
| Importar, editar o borrar excolaboradores | `retirados_recalcular_registros` (after, por sentencia) → `private.recalcular_retiros()` | Todos los registros; solo escribe los que cambian (~10 ms) |

Los recálculos no tocan `updated_at` (su trigger solo reacciona a las columnas que edita el usuario). Si hiciera falta forzar un recálculo: `select private.recalcular_retiros();`.

El algoritmo de coincidencia (`anticipos.match_colaborador_retirado` / `_batch`):

1. **Normaliza** nombres: minúsculas, sin tildes (`á→a`, `ñ→n`), sin símbolos, separa en tokens.
2. Compara contra `anticipos.retirados.nombre`. Un candidato es válido si **todos los tokens del nombre buscado están en el del reporte**.
3. Clasifica el **nivel**: `exacto` (mismos tokens en el mismo orden) → `exacto_inverso` (orden "apellido nombre") → `parcial`.
4. Por cada nombre consultado conserva el **mejor candidato** (`row_number`): primero el nivel, luego el que tenga **menos tokens extra** (segundo nombre/apellido), luego la cédula menor.

El resultado incluye `tokens_comunes` y `tokens_extra` para que el usuario pueda **desambiguar** coincidencias parciales.

## Archivos fuente

- Página: `src/app/(app)/ingresos-egresos/gestion-anticipos/page.tsx`
- UI: `src/components/anticipos/` (`anticipos-page`, `anticipo-sheet`, `anticipos-form`, `badges`, `legalizar-boton`, `tour`, `importar-retirados/`)
- Lógica: `src/lib/anticipos/{actions,schema,format,seguimiento,export-excel}.ts`
- SQL: `supabase/migrations/20261016120000_match_colaborador_retirado.sql`, `…130000_match_colaborador_retirado_batch.sql`, `20261029150000_retirados_tokens.sql`, `20261029190000_registros_retiro_materializado.sql`

## Hallazgos

1. **Límite silencioso de 1.000 registros**: si se supera, los más antiguos dejan de verse.
2. ~~El cruce se ejecutaba en cada carga~~: resuelto, ahora se guarda en el registro (ver [Cruce con excolaboradores](#cruce-con-excolaboradores)).
3. Una coincidencia `parcial` puede ser un falso positivo (homónimos): el campo `es_retirado` es `true` para cualquier nivel, incluida la coincidencia parcial.
4. El enum `revisar_con_harold` contiene un nombre propio; un cambio de responsable exige migración.
5. Migración de la tabla, enums y políticas no versionadas en el repo.

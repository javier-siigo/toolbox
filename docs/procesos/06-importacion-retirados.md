# Importación y búsqueda de excolaboradores (retirados)

## Qué hace

Mantiene la tabla **`anticipos.retirados`** a partir del **reporte de Contabilidad de excolaboradores** (Excel). Sirve de base para marcar, en [Gestión de anticipos](05-gestion-anticipos.md), qué anticipos pertenecen a personas que ya salieron. Tiene tres puertas de entrada:

| Vía | Quién | Cómo |
|---|---|---|
| Web | Roles `ingresos` o `admin` | Hoja lateral "Importar excolaboradores" en `/ingresos/gestion-anticipos` |
| CLI de importación | Desarrollador/administrador | `npm run import:retirados -- /ruta/archivo.xlsx` |
| CLI de búsqueda | Desarrollador/administrador | `npm run match:retirado -- "Juan Lopez"` |

## Conexiones

| Conexión | Uso |
|---|---|
| Supabase BD con **service role** | Upsert en `anticipos.retirados` y registro en `anticipos.retirados_imports` |
| Supabase RPC `anticipos.match_colaborador_retirado` | Búsqueda del script `match:retirado` |
| n8n / APIs externas | Ninguna |

## Importación

Núcleo único: `importRetiradosXlsx` en `src/lib/retirados/import.ts`, compartido por la Server Action web y el script CLI.

### Formato esperado del Excel

Primera hoja del libro; la **fila 1 es encabezado y se omite**.

| Columna | Contenido | Uso |
|---|---|---|
| A | `CEDULA` | Número > 0 (clave) |
| B | `NOMBRE` | Texto no vacío |
| C | `TIENE ANTICIPO` | **Se ignora** |
| D | `VALOR` | Número; vacío o `"Si"` → `null` |
| E | `OBSERVACION` | Texto opcional |

Las filas sin cédula numérica positiva o sin nombre se descartan en silencio.

### Reglas

- Solo `.xlsx` / `.xls`; tamaño máximo **5 MB**; archivo no vacío.
- Si no queda ninguna fila válida: error "El archivo no contiene filas válidas (se esperan columnas CEDULA, NOMBRE, TIENE ANTICIPO, VALOR, OBSERVACION)".
- **Upsert** por `cedula` en lotes de **100** filas (`onConflict: cedula`). Si un lote falla, sus filas cuentan como `errors`.
- Registra cada importación en `anticipos.retirados_imports` (nombre y tamaño del archivo, filas totales, `upserted`, `errors`, quién importó).
- Resultado a la UI: `fileName`, `total`, `upserted`, `errors`.

### Permisos (versión web)

`importarRetiradosAction` (`src/lib/retirados/actions.ts`): exige nivel `usar` en Gestión de anticipos (`autorizar(PROCESOS.GESTION_ANTICIPOS, "usar")`); la escritura se hace con el **cliente admin** (se salta RLS). Al terminar revalida `/ingresos/gestion-anticipos`.

### Script CLI

`scripts/import-retirados.ts`. Carga `.env.local` (necesita `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`), lee el archivo, lo envuelve en un `File` y llama a `importRetiradosXlsx`. Imprime `✓ Importación completa: N/M filas procesadas, K con error` o sale con código 1.

## Búsqueda manual — `match:retirado`

`scripts/match-retirado.ts`. Identifica a un excolaborador desde un nombre libre ("nombre apellido" o "apellido nombre") usando la RPC `anticipos.match_colaborador_retirado`.

```bash
npm run match:retirado -- "Juan Lopez"
npm run match:retirado -- "LOPEZ JUAN"
npm run match:retirado -- --cedula 1055988289
echo "DIEGO NOVA" | npm run match:retirado -- --stdin
npm run match:retirado -- --json --no-interactive "Juan Diego"
```

- Niveles de coincidencia: `cedula`, `exacto`, `exacto_inverso`, `parcial`.
- Límite de candidatos parciales: 25 (`FUZZY_LIMIT`).
- En modo interactivo deja elegir entre varios candidatos; `--json` y `--no-interactive` sirven para automatizar.

## Datos

| Tabla | Columnas |
|---|---|
| `anticipos.retirados` | `cedula` (clave del upsert), `nombre`, `nombre_normalizado` (generada), `valor`, `observacion`, `fecha_reporte`, `created_at` |
| `anticipos.retirados_imports` | `id`, `file_name`, `file_size`, `total_rows`, `upserted`, `errors`, `imported_by`, `imported_at` |

Funciones SQL (migraciones `…120000` y `…130000`): `private.normalize_colaborador_name_unsorted(text)`, `anticipos.match_colaborador_retirado(text)`, `anticipos.match_colaborador_retirado_batch(text[])`. Detalle del algoritmo en [05](05-gestion-anticipos.md#cruce-con-excolaboradores).

## Archivos fuente

`src/lib/retirados/{actions,import}.ts` · `src/components/anticipos/importar-retirados/` · `scripts/import-retirados.ts` · `scripts/match-retirado.ts`

## Hallazgos

1. La importación es **solo upsert**: los excolaboradores que desaparecen del reporte nuevo **no se eliminan**.
2. El payload del upsert no incluye `fecha_reporte`, así que en filas existentes no se actualiza (salvo que haya un trigger fuera del repo).
3. Los errores se reportan como **conteo** por lote, sin detalle de qué fila falló.
4. La acción revalida la ruta `/admin/importar-retirados`, que **no existe** (resto de una versión anterior).
5. Las filas inválidas se descartan sin avisar al usuario.

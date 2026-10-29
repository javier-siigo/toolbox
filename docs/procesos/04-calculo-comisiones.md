# Cálculo de comisiones (reconocimiento del gasto por cohortes)

## Qué hace

Automatiza el **cierre mensual del reconocimiento del gasto de comisiones** que antes se llevaba en el Excel "Reconocimiento gasto de comisiones". Las comisiones causadas en un mes (la **cohorte**) no se llevan de una vez al gasto: se **difieren** y se reconocen al mismo ritmo en que se reconoce el ingreso de las facturas F93/F94 emitidas ese mes.

```
% del mes = ingreso F93+F94 de la cohorte reconocido en el mes
            ÷ facturación neta F93+F94 de la cohorte (facturas − notas crédito)

gasto del mes = comisiones de la cohorte × % del mes
```

Cada mes el portal calcula, para **todas las cohortes vigentes**, el gasto a reconocer, genera los **asientos contables**, ejecuta **controles de calidad**, guarda el cierre y exporta un Excel de soporte.

## Acceso

Ruta `/ingresos/calculo-comisiones`, área Ingresos. Proceso `ingresos.calculo-comisiones`: la página exige acceso (`requireAcceso`); leer pide `ver` y cualquier escritura (conceptos, valores, facturación, cierres) pide `usar`, en las server actions y en RLS. Con `ver` los paneles editables quedan deshabilitados y no se puede guardar ni eliminar cierres; sí cargar el informe y exportar. Si Supabase falla, la página sigue abriendo y muestra `errorDatos`.

## Conexiones

| Conexión | Uso |
|---|---|
| Supabase BD (con sesión del usuario, RLS) | Lectura/escritura de las tablas `comisiones.*` y RPC `comisiones.guardar_cierre` |
| n8n / APIs externas | **Ninguna**. Todo el procesamiento ocurre en Supabase y en el navegador |
| Archivo Informe Diferido (`.xlsx`) | Subido manualmente por el usuario (proviene de la contabilidad/NetSuite según los comentarios del código); se procesa **localmente en un Web Worker** y **no se envía al servidor** |

## Flujo del usuario

La pestaña **Cierre del mes** tiene 4 pasos (con barra de progreso). Por defecto abre el **mes anterior** al actual (el informe de un mes llega a inicios del siguiente).

| Paso | Qué se captura | Acción / tabla |
|---|---|---|
| 1. Comisiones causadas | Valor por concepto del período (Comisiones ventas, Incentivos, Bonificaciones, Ventas cruce…). Permite crear, renombrar, activar/desactivar conceptos y asignar su cuenta contable | `guardarValores` → `comisiones.periodo_valores`; `crearConcepto`/`actualizarConcepto` → `comisiones.conceptos` |
| 2. Facturación del mes | Facturas y notas crédito de **F93** y **F94** del período (los valores se toman de NetSuite y se digitan) | `guardarBase` → `comisiones.bases` |
| 3. Informe diferido | Se arrastra/selecciona el `.xlsx` del mes. Se lee en el navegador con barra de progreso | Worker `informe-diferido.worker.ts` |
| 4. Revisión y asientos | Resumen por cohorte, controles, asientos, tabla de documentos. Botones **Guardar cierre** y **Exportar Excel** | `guardarCierre` (RPC) · `construirExcel` |

La pestaña **Seguimiento** muestra, por cohorte, cómo avanza el reconocimiento mes a mes (`calcularSeguimiento`) y permite abrir un cierre existente.

Si el período ya tiene datos guardados (cierre guardado o histórico del Excel) se puede revisar **sin cargar el informe**; en ese caso el ingreso sale de lo registrado.

## Cómo se procesa el Informe Diferido

`src/lib/comisiones/informe-diferido.ts`, `informe-diferido.worker.ts`, hook `use-informe-diferido.ts`

El archivo mensual pesa **~170 MB comprimido (~800 MB de XML, 700 mil+ filas)**: no cabe con la librería `xlsx`. Por eso:

1. Un **Web Worker** abre el `.xlsx` como ZIP (soporta ZIP64), lee el directorio central y descomprime con `DecompressionStream`.
2. Fases con progreso: `abriendo → textos` (tabla de cadenas compartidas) `→ filas` (por bloques) `→ agrupando`.
3. Localiza la hoja de datos y la **fila de encabezados** (columna `NO COMPROBANTE`, dentro de las primeras 20 filas). Reconoce encabezados con alias (p. ej. `FECHAFACTURA`/`FECHA_FACTURA`).
4. Columnas relevantes: `NO COMPROBANTE`, `DOC ORIGEN`, `CUOTA`, `RECONOCIDO`, `PENDIENTE_POR_DIFERIR`, `NIT`, `FECHAFACTURA`, `FECHA_DIFERIDO`, además de producto, cuenta, cantidad, total, plazo (veces, inicio, fin) y tipo de documento.
5. **Reglas de negocio** (validadas contra el Excel de contabilidad):
   - Una línea es **base de comisión** si su `DOC ORIGEN` empieza por **F93** o **F94**. Así entran las facturas, sus notas crédito y los asientos de ajuste sobre ellas. Las demás (otros prefijos) se cuentan como **excluidas**.
   - La **cohorte** es el mes de `FECHAFACTURA`.
   - El **ingreso reconocido** del mes es la suma de `CUOTA`, calculada en **centavos enteros** para que cuadre exacto.
   - Tipo de documento: por la columna de tipo (`NOTA` → nota crédito, `ASIENTO` → ajuste, `FACTURA` → factura); si falta, por `NO COMPROBANTE` frente a `DOC ORIGEN`.
   - Período detectado = mes de `FECHA_DIFERIDO`. Si hay varios meses se marca `periodosMezclados` y se usa el más reciente.
   - Sin columna `DOC ORIGEN` se clasifica por `NO COMPROBANTE` (con advertencia: puede no cuadrar).
   - Se reporta cuántas líneas tienen `RECONOCIDO + PENDIENTE ≠ TOTAL` (tolerancia $1).
6. Resultado (`ResultadoArchivo`): ingresos por cohorte y prefijo (con facturas/NC/ajustes), documentos con sus líneas, líneas excluidas, líneas sin fecha, descuadres y duración.

## Motor de cálculo

`src/lib/comisiones/calculo.ts` (función `calcularCierre`). Todo en **centavos enteros**; débitos y créditos se arman con líneas ya redondeadas, así que **siempre cuadran**.

Para cada cohorte (meses con comisiones hasta el período, más la del mes) y cada concepto, el gasto del mes sigue estas reglas **en orden**:

1. **Gasto registrado**: si existe un valor contabilizado a mano para (cohorte, mes, concepto) en `comisiones.gasto_registrado`, ese es el gasto.
2. **Fórmula**: `comisión × (ingreso del mes ÷ facturación neta de la cohorte)`.
3. **Tope**: nunca se lleva al gasto más de lo causado (también para conceptos negativos, p. ej. reversiones de incentivos). El mes en que se alcanza el tope se reconoce **solo el saldo**.
4. **Cierre por ingreso terminado**: si el informe muestra que las facturas de la cohorte ya no tienen ingreso por diferir (pendiente ≤ **$1.000**, `UMBRAL_PENDIENTE`) y aún queda comisión diferida, el saldo se amortiza ese mes como **ajuste de cierre**.

El acumulado previo de cada cohorte se reconstruye recorriendo los meses anteriores con las mismas reglas.

Cohortes totalmente amortizadas y sin movimiento no aparecen. Una cohorte sin comisiones solo se muestra si es la del mes.

### Alertas por cohorte

`sin-base`, `sin-comisiones`, `sin-ingreso`, `tope`, `cierre`, `registrado`, `ingreso-negativo`, `difiere-registro` (el ingreso del informe difiere del ya registrado en ≥ $1).

## Asientos generados

Cuenta del diferido: **17109501 – Comisiones de ventas diferidas**. Cuentas de gasto: las de cada concepto.

| Tipo | Cohorte | Débito | Crédito |
|---|---|---|---|
| `diferimiento` | Del mes | 17109501 (por la parte que se difiere) | Cuenta de gasto de cada concepto |
| `amortizacion` | Cada cohorte anterior (un asiento por cohorte) | Cuentas de gasto por el gasto del mes | 17109501 |
| `ajuste-cierre` | Cohortes que cierran | Cuentas de gasto por el saldo pendiente | 17109501 |

Montos negativos invierten el lado (reversas).

Conceptos y cuentas iniciales (semilla de migración):

| Concepto | Cuenta |
|---|---|
| Comisiones ventas | 52051801 |
| Incentivos | 52051802 |
| Bonificaciones ventas | 52054801 |
| Comisiones por ventas cruce | 52950502 |

## Controles (`controles.ts`)

Los controles en **error impiden guardar** el cierre.

| Estado | Controles |
|---|---|
| **Error** | Período del archivo distinto al del cierre · líneas F93/F94 sin `FECHAFACTURA` · faltan comisiones del mes · falta facturación neta del mes · cohortes sin facturación · conceptos sin cuenta contable · asientos descuadrados |
| **Revisar (warning)** | Varios meses en el archivo · sin `DOC ORIGEN` · saldo ≠ total · ingreso distinto al registrado · ajuste por cierre de cohorte (revisar soporte) · cohorte con comisión diferida sin ingreso en el mes · ingreso negativo (gasto negativo = reversa) |
| **Info** | Cohortes que cierran este mes (tope) o el próximo · ingreso de meses sin comisiones registradas · líneas que no son base |
| **OK** | Período del archivo correcto · asientos cuadrados |

## Persistencia

### Guardar cierre — `guardarCierre`

Valida período `YYYY-MM`, que ninguna cohorte sea posterior al período y los importes. Llama a la RPC **`comisiones.guardar_cierre`** (`SECURITY INVOKER`, así que aplica RLS), que de forma **atómica**:

1. Borra los `comisiones.reconocimientos` del período.
2. Inserta los nuevos (fuente `informe`).
3. Inserta/actualiza `comisiones.cierres` (resumen, `asientos` y `controles` en JSON).

> Del informe **no se guarda el detalle por factura**: solo el ingreso por cohorte/prefijo y el pendiente. El detalle se recalcula releyendo el archivo.

### Eliminar cierre — `eliminarCierre`

Borra el cierre y los reconocimientos de **fuente `informe`** de ese período; **conserva el histórico cargado desde el Excel**. Son dos operaciones separadas (no atómicas).

### Tablas (migraciones `20261016140000`, `…150000`, `…150100`)

| Tabla | Clave | Contenido |
|---|---|---|
| `comisiones.conceptos` | `id` | Catálogo editable: `nombre` (único sin mayúsculas/espacios), `cuenta` (4–12 dígitos), `activo`, `orden` |
| `comisiones.periodo_valores` | `(periodo, concepto_id)` | Comisiones causadas por concepto en el período (`numeric(18,2)`) |
| `comisiones.bases` | `(periodo, prefijo)` | Facturas y notas crédito F93/F94 emitidas en el mes |
| `comisiones.reconocimientos` | `(cohorte, periodo, prefijo)` | Ingreso reconocido en `periodo` de la `cohorte`, `pendiente_ingreso`, `fuente` (`informe`/`excel`); `cohorte ≤ periodo` |
| `comisiones.gasto_registrado` | `(cohorte, periodo, concepto_id)` | Gasto contabilizado a mano que difiere de la fórmula, con `motivo`. **Manda sobre el cálculo** |
| `comisiones.cierres` | `periodo` (único) | Resumen del cierre: `gasto_mes`, `diferido_nuevo`, `saldo_diferido`, `asientos`, `controles`, archivo |

`comisiones_ejecuciones` (modelo anterior de "pool global") fue **eliminada**.

Todas tienen **RLS** con dos políticas: `<tabla>_ver` (SELECT con `private.tiene_acceso('ingresos.calculo-comisiones', 'ver')`) y `<tabla>_usar` (todo con nivel `usar`).

### Histórico

La migración `20261016150100_comisiones_historico.sql` carga 2025 y 2026 hasta **agosto 2026** (de **septiembre en adelante se cierra en el portal**). Reproduce el Excel con diferencias de centavos por redondeo por línea y documenta los casos donde lo contabilizado difiere de la fórmula:

- Cohorte abril 2025 en marzo 2026: se registró a mano 29.327.040,95 → cargado como gasto registrado.
- Cohorte abril 2025 en abril 2026: sus facturas terminaron de reconocer ingreso (residuo de $5,30) y contabilidad llevó todo el saldo (116.287.390,85) → el portal aplica el cierre de cohorte.
- Cohortes febrero, marzo y mayo 2025: el último mes se registró solo el saldo → regla de tope.
- Cohorte junio 2026 en julio 2026: la hoja fija 243.707.008,43 pero anota que lo correcto es 233.209.032,35 → el portal usa el correcto.

## Exportación a Excel

`exportar.ts` + `xlsx-writer.ts` (escritor propio de `.xlsx`). Se ejecuta en el Worker si hay informe cargado; si no, por importación dinámica en el hilo principal. Libro con: **resumen por cohorte** (facturación neta, ingreso F94/F93, % del mes, comisiones, gasto, ajuste de cierre, acumulado, % acumulado, pendiente), **asientos**, **conceptos**, **ingreso** y **documentos**, más los controles.

## Archivos fuente

- Página: `src/app/(app)/ingresos/calculo-comisiones/page.tsx`
- UI: `src/components/calculo-comisiones/` (`calculo-comisiones-page`, `base-panel`, `conceptos-panel`, `informe-panel`, `revision-panel`, `seguimiento-tab`, `documentos-table`, `periodo-picker`, `paso`, `progress-bar`, `use-informe-diferido.ts`)
- Dominio: `src/lib/comisiones/` (`types`, `calculo`, `controles`, `actions`, `informe-diferido`, `informe-diferido.worker`, `exportar`, `xlsx-writer`)
- SQL: `supabase/migrations/20261016140000_comisiones.sql`, `…150000_comisiones_cohortes.sql`, `…150100_comisiones_historico.sql`

## Hallazgos

1. **No hay interfaz para `comisiones.gasto_registrado`**: los ajustes manuales se cargan por SQL/migración.
2. Los valores de comisiones y la facturación F93/F94 se **digitan a mano**; no hay integración con NetSuite.
3. El informe se relee cada vez (no se guarda el detalle); si cambia el archivo, el resultado cambia.
4. `eliminarCierre` no es atómico (borra cierre y luego reconocimientos).
5. La página no valida rol en servidor; la seguridad depende de RLS.
6. Es el proceso más complejo del repo (≈ 2.700 líneas solo en `src/lib/comisiones`): candidata a **pruebas unitarias** sobre `calcularCierre` usando los casos históricos como fixtures.

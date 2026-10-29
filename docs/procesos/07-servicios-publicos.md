# Servicios públicos

## Qué hace

Control y seguimiento de los **recibos de servicios públicos** desde que se espera la factura hasta que Tesorería la paga y se adjunta el soporte:

**Factura → Registro (envío a Tesorería) → Pago → Soporte**

No automatiza el registro contable ni lee correos: da trazabilidad, avisa qué está atrasado y cuenta los recibos de cada mes sin hacerlo a mano. Reemplaza el seguimiento en Excel (pestaña *Bogota*).

## Acceso

Ruta `/ingresos-egresos/servicios-publicos`, proceso `egresos.servicios-publicos` (área **Ingresos y egresos**; el id conserva el prefijo `egresos.` con el que se creó). Leer y descargar soportes pide `ver`; crear, editar, marcar pasos, adjuntar soportes, preparar el mes y administrar el catálogo de servicios piden `usar`, en las server actions y en RLS. Con `ver` la página se muestra sin acciones. Los permisos se asignan en Administración › Usuarios.

## Conexiones

| Conexión | Uso |
|---|---|
| Supabase BD (sesión del usuario) | Todo el CRUD, con RLS |
| Supabase Storage (service role) | URLs firmadas para subir y ver soportes, y borrado de archivos reemplazados |
| n8n / APIs externas | **Ninguna** |

## Modelo de datos

Schema `servicios_publicos` (migración `20261029200000_servicios_publicos.sql`).

| Tabla | Para qué |
|---|---|
| `servicios` | Catálogo de lo que llega cada mes: `proveedor`, `servicio` (Energía, Acueducto…), `referencia` (cuenta/contrato), `dia_corte` (1–31), `activo`, `notas`. No se borran: se **desactivan** y conservan su histórico. Único por proveedor + servicio + referencia. |
| `recibos` | Un recibo por servicio y **mes** (`mes` = primer día del mes; único `servicio_id + mes`): `referencia`, `valor`, `fecha_corte`, `fecha_recibido`, `fecha_registro`, `fecha_pago`, `soporte_path/nombre/subido_at`, `observaciones`, `created_*`/`updated_*`. |
| `recibos_historial` | Bitácora automática (trigger `recibos_registrar_historial`): creación, cambios de estado, de valor y de soporte, con el correo de quien lo hizo y la hora. Solo lectura para los usuarios. |

### Estado: derivado de las fechas

El estado **no se elige**: es una columna generada a partir de las fechas, así nunca queda en contradicción con ellas.

| Estado | Condición | En pantalla |
|---|---|---|
| `pendiente_factura` | Sin fechas | Sin factura |
| `recibido` | `fecha_recibido` | Por registrar |
| `registrado` | `+ fecha_registro` (enviado a Tesorería) | Pendiente de pago |
| `pagado` | `+ fecha_pago` | Pagado |

Checks de la tabla (el formulario los valida antes con mensajes claros): registrar exige factura y valor; pagar exige registro; las fechas van en orden (factura ≤ registro ≤ pago); el soporte solo existe en recibos pagados y siempre con nombre.

### Preparar el mes

`servicios_publicos.preparar_mes(p_mes)` crea los recibos `pendiente_factura` del mes para los servicios **activos** que aún no lo tienen, con la referencia del servicio y `fecha_corte` = día de corte en ese mes (31 en febrero → 28/29). Es idempotente y corre con la RLS de quien la llama. En la página aparece como el aviso "N servicios activos no tienen recibo en …" → **Crear pendientes**.

## Semáforo (alertas)

Reglas en **un solo archivo**: `src/lib/servicios-publicos/alertas.ts` (`alertaDe`). La tabla, los indicadores, el filtro "Semáforo" y el detalle lo usan; ningún componente decide por su cuenta. "Hoy" se calcula en el servidor en hora de Colombia.

| Estado | 🟢 Al día | 🟡 Atención | 🔴 Requiere revisión |
|---|---|---|---|
| Pendiente de factura | Faltan más de 3 días para el corte | Corte en ≤ 3 días, hoy, o sin fecha de corte | El corte ya pasó y no llega la factura |
| Factura recibida | — | Falta registrarlo | Más de 3 días sin registrar |
| Registrado | — | En Tesorería, pendiente de pago | Más de 10 días sin pago |
| Pagado | Con soporte | Falta el soporte | — |

Los umbrales son constantes en ese archivo (`DIAS_AVISO_CORTE`, `DIAS_PARA_REGISTRAR`, `DIAS_PARA_PAGO`).

## Conteo mensual

"Recibos registrados por mes" se **calcula** de los recibos (no hay contador guardado): por cada mes, cuántos están registrados o pagados sobre el total del mes. Cada mes es un botón que filtra la tabla; "Todos" muestra el histórico completo. El mes es el **mes del recibo** (`mes`), no la fecha en que se registró.

## Soportes de pago

Bucket privado `servicios-publicos-soportes` (PDF, PNG, JPG, WEBP, HEIC; máx. 10 MB). Mismo patrón que conciliaciones: el servidor autoriza y entrega una URL firmada, y el navegador sube directo a Storage.

1. `prepararSubidaSoporte` valida tipo/tamaño y que el recibo esté pagado → URL firmada para `<recibo_id>/<uuid>.<ext>`.
2. El navegador sube con `PUT`.
3. `confirmarSoporte` verifica que el archivo exista y lo asocia al recibo. Si falla, borra el archivo subido; si reemplaza uno anterior, borra el anterior **después** de guardar.

Ver un soporte genera una URL firmada de 60 s. Eliminar un recibo borra también su archivo. El bucket **no** está en la limpieza diaria de Storage.

Al marcar pagado se puede adjuntar el soporte en el mismo paso. Si el pago se guarda y la subida falla, se avisa explícitamente ("Pago guardado, pero el soporte no se subió") para adjuntarlo después.

## Operaciones (Server Actions, `src/lib/servicios-publicos/actions.ts`)

| Acción | Nivel | Qué hace |
|---|---|---|
| `getServiciosPublicos()` | ver | Servicios + hasta 3.000 recibos (`MAX_RECIBOS`), más recientes primero |
| `getHistorialRecibo(id)` | ver | Bitácora del recibo |
| `guardarRecibo` | usar | Crea o edita (todas las fechas). Duplicado servicio+mes → error en el campo |
| `marcarPaso(id, "registrar" \| "pagar", fecha)` | usar | Avanza un paso solo si el recibo sigue en el estado anterior; si otro usuario lo cambió, lo dice |
| `prepararMes(mes)` | usar | RPC `preparar_mes` |
| `eliminarRecibo(id)` | usar | Borra recibo, historial y soporte (para corregir errores) |
| `prepararSubidaSoporte` / `confirmarSoporte` / `quitarSoporte` / `urlSoporte` | usar / ver | Soportes |
| `guardarServicio` / `cambiarActivoServicio` | usar | Catálogo |

Los errores de BD se traducen a mensajes para el usuario (`mensajeDeError`) y el detalle técnico queda en el log del servidor con el prefijo `[servicios-publicos]`.

## Interfaz

`src/components/servicios-publicos/`

- **Indicadores** (todos los meses, clic = filtro): requieren revisión, facturas por llegar, pendientes de pago (con valor) y registrados del mes.
- **Conteo por mes**: fila de meses con registrados / total.
- **Filtros**: búsqueda (proveedor o referencia), proveedor, estado, semáforo, pago (pagados / sin pagar).
- **Tabla**: semáforo con motivo, servicio, mes, corte, valor, estado, pago, soporte y **un botón con el siguiente paso** (`siguiente-paso.tsx`): *Llegó la factura* → *Registrar* → *Marcar pagado* → *Adjuntar soporte*.
- **Detalle** (clic en la fila): progreso de los 4 pasos, datos, soporte (ver / reemplazar / quitar), historial, editar y eliminar.
- **Servicios**: catálogo (agregar, editar, activar/desactivar).

## Datos históricos (Excel)

El portal guarda el histórico (un recibo por servicio y mes; nada se borra al cambiar de mes), pero **no se migró** el Excel: hay que revisar primero la pestaña *Bogota* (filas ocultas y contenido antiguo) y decidir qué meses traer. Con el archivo, la importación sería: crear los servicios, y por cada fila útil un recibo con sus fechas; el estado se deriva solo.

## Archivos fuente

- Página: `src/app/(app)/ingresos-egresos/servicios-publicos/page.tsx`
- UI: `src/components/servicios-publicos/`
- Lógica: `src/lib/servicios-publicos/{actions,schema,alertas}.ts`
- SQL: `supabase/migrations/20261029200000_servicios_publicos.sql`

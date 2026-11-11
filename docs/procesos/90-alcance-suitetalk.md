# Alcance de SuiteTalk

Inventario de lo que la integración SuiteTalk del portal puede leer de NetSuite, con ejemplos listos para probar. Sirve para responder rápido, antes de comprometer un desarrollo, si un dato **se puede obtener**, **por qué canal** y **con qué limitaciones**.

Los datos de este documento salen de un sondeo de solo lectura hecho el **10/11/2026** con las mismas credenciales del portal: se pidió el catálogo de registros, se intentó `SELECT *` sobre 794 tablas en SuiteQL y se listaron los 748 tipos de la REST Record API. No se escribió nada en NetSuite. Aquí solo hay nombres de tablas, columnas y conteos; ningún valor de clientes, empleados o transacciones.

Cada bloque `suiteql` tiene el botón **Probar en consola**, que abre la [Consola SuiteQL](/admin/suiteql) con la query cargada. Si el permiso del rol cambia en NetSuite, este inventario puede quedar desactualizado: la consola siempre dice la verdad del momento.

## Resumen

| Canal | Estado | Para qué sirve |
|---|---|---|
| Token OAuth 2.0 (client credentials, JWT PS256) | Funciona. Dura 1 hora. Scopes `restlets` y `rest_webservices` | Autenticación de todo lo demás |
| **SuiteQL** (`/query/v1/suiteql`) | Funciona. **747 de 794** tablas probadas responden | Consultar casi cualquier dato: transacciones, líneas contables, maestros, metadatos. Es el canal principal |
| REST Record API · listar (`/record/v1/<tipo>`) | **729 de 748** tipos responden | Listar ids de registros, con filtro `q` |
| REST Record API · detalle (`/record/v1/<tipo>/<id>`) | Funciona **solo con `Accept-Language: en`** | Leer un registro completo con sublistas, en camelCase |
| Metadata catalog (`/record/v1/metadata-catalog`) | Funciona: 748 tipos de registro, esquema JSON por tipo | Descubrir tipos y campos (incluye tipos sin registros) |
| Escritura (crear/editar/borrar) | **No probada.** SuiteQL rechaza todo lo que no sea `SELECT` | El portal hoy solo lee. Escribir por REST dependería de los permisos del rol |
| RESTlets | El token tiene el scope, pero no hay RESTlets identificados ni probados | Solo si alguien despliega un script con su URL |
| Búsquedas guardadas | No se pueden ejecutar por REST. La tabla `savedsearch` solo trae metadatos | Replicar la lógica de la búsqueda en SuiteQL |
| SuiteTalk SOAP | No configurado | — |

## Cómo se conecta el portal

Todo pasa por `src/lib/netsuite/client.ts`, solo en el servidor:

1. Arma un JWT firmado con PS256 (`NETSUITE_CERT_ID` como `kid`, `NETSUITE_CONSUMER_KEY` como `iss`) y lo cambia por un access token en `/services/rest/auth/oauth2/v1/token`.
2. Con ese token llama a SuiteQL (`POST /services/rest/query/v1/suiteql?limit=…&offset=…`, header `Prefer: transient`) o a la REST Record API.
3. Reintenta con backoff ante `429`, `5xx` y errores de red.

| Variable | Uso |
|---|---|
| `NETSUITE_ACCOUNT_ID` | Cuenta. Arma el dominio `<cuenta>.suitetalk.api.netsuite.com` |
| `NETSUITE_CONSUMER_KEY` | Client ID de la integración (emisor del JWT) |
| `NETSUITE_CERT_ID` | Id del certificado cargado en la integración |
| `NETSUITE_PRIVATE_KEY` | Llave privada PKCS#8 del certificado |

Lo que se puede leer lo decide el **rol** asociado a la integración en NetSuite, no el portal. Si un dato no aparece, primero hay que preguntarse si el rol lo ve.

## La cuenta en cifras

| Dato | Valor |
|---|---|
| Subsidiarias | 13 (incluye las de eliminación) |
| Libros contables | 2: Primary Accounting Book y Libro Secundario USD |
| Monedas | 9: COP, USD, CAD, EUR, PEN, UYU, UI, MXN, CLP |
| Periodos contables | 247 mensuales, de 1/1/2019 a 31/12/2037 |
| Transacciones | 28.095.409, con fecha desde 31/10/2020 |
| Líneas contables de un mes (oct-2026) | 3.611.298 |
| Clientes | 1.175.853 |
| Proveedores | 11.945 |
| Empleados | 12.746 |
| Cuentas contables | 2.240 |
| Ítems | 7.058 |
| Campos personalizados | 5.219 |
| Registros personalizados legibles | 406 |
| Listas personalizadas legibles | 201 |

Subsidiarias que devuelve la cuenta:

| Id | Nombre | País | Eliminación |
|---|---|---|---|
| 1 | Empresa principal | CO | No |
| 2 | SIIGO HOLDING ELIMINATION | CO | Sí |
| 3 | SIIGO S.A.S | CO | No |
| 10 | SIIGO S.A.S ELIMINACION | CO | Sí |
| 14 | ZUKALO S.A. | EC | No |
| 15 | MEMORY S.A. | UY | No |
| 16 | SICONT MEX | MX | No |
| 17 | SIIGO CHILE SPA | CL | No |
| 20 | ASPEL COLOMBIA SAS | CO | No |
| 21 | TOTAL SOLUTIONS PROVIDER | MX | No |
| 22 | EDITORA ACTUALICESE.COM S.A.S. | CO | No |
| 23 | PORTAL ACTUALICESE.COM S.A.S | CO | No |
| 24 | BSALE CHILE | CL | No |

Con estos volúmenes, **ninguna consulta sobre transacciones o líneas debe ir sin filtro de fecha**: un mes ya son millones de líneas y el tope por consulta es 100.000 filas.

## Qué se puede consultar

Agrupado por dominio. Las columnas listadas son las que aparecieron en una muestra; SuiteQL **omite las columnas vacías**, así que puede haber más. Tipos observados: `texto`, `entero`, `decimal`, `fecha` (dd/mm/aaaa), `fecha-hora` y `T/F` (booleano).

### Transacciones y contabilidad

El corazón de casi cualquier requerimiento contable. Tres tablas se combinan:

| Tabla | Granularidad | Ejemplos de uso |
|---|---|---|
| `transaction` | Una fila por documento (factura, pago, asiento…) | Número, fecha, tipo, estado, tercero, moneda, campos `custbody_*` |
| `transactionline` | Una fila por línea del documento | Ítem, cantidad, departamento, clase, ubicación, memo, segmentos `cseg_*` |
| `transactionaccountingline` | Una fila por impacto contable (por libro) | Cuenta, débito, crédito, monto, libro contable |

Líneas contables de un día con cuenta y departamento (la base de la exportación de bancos; amplía el rango con cuidado, un mes son millones de líneas):

```suiteql
SELECT t.id, t.tranid, t.trandate, BUILTIN.DF(t.type) AS tipo,
       a.acctnumber, BUILTIN.DF(tal.account) AS cuenta,
       tal.debit, tal.credit, tl.memo, BUILTIN.DF(tl.department) AS departamento
FROM transaction t
JOIN transactionline tl ON tl.transaction = t.id
JOIN transactionaccountingline tal ON tal.transaction = tl.transaction AND tal.transactionline = tl.id
JOIN account a ON a.id = tal.account
WHERE t.trandate BETWEEN TO_DATE('2026-10-01', 'YYYY-MM-DD') AND TO_DATE('2026-10-01', 'YYYY-MM-DD')
  AND tal.posting = 'T' AND tal.accountingbook = 1
ORDER BY t.id, tl.id
```

Cuántos documentos hay por tipo en un mes:

```suiteql
SELECT type, COUNT(*) AS n
FROM transaction
WHERE trandate BETWEEN TO_DATE('2026-10-01', 'YYYY-MM-DD') AND TO_DATE('2026-10-31', 'YYYY-MM-DD')
GROUP BY type
```

Códigos de `type` que aparecen (internos, en inglés): `CustInvc` factura de venta, `CustCred` nota crédito, `CustPymt` pago de cliente, `CustDep` depósito de cliente, `CashSale` venta de contado, `VendBill` factura de compra, `VendCred` nota crédito de proveedor, `VendPymt` pago a proveedor, `Journal` asiento, `Check` cheque, `Deposit` depósito, `Transfer` transferencia, `ExpRept` reporte de gastos, `Custom` transacción personalizada. `BUILTIN.DF(type)` devuelve el nombre en español.

Las vistas por tipo (`invoice`, `vendorbill`, `journalentry`, `customerpayment`, `vendorpayment`, `creditmemo`, `cashsale`, `check`, `expensereport`…) también existen como tablas y traen solo los campos de ese tipo, pero `transaction` filtrando por `type` cubre lo mismo y se puede unir con las líneas.

Estado de un documento en texto legible:

```suiteql
SELECT t.tranid, t.status, BUILTIN.DF(t.status) AS estado, ts.fullname
FROM transaction t
LEFT JOIN transactionstatus ts ON ts.id = t.status AND ts.trantype = t.type
WHERE t.type = 'CustInvc' AND t.trandate >= TO_DATE('2026-11-01', 'YYYY-MM-DD')
```

Documentos relacionados (factura → pago, orden → factura):

```suiteql
SELECT ptl.previousdoc, ptl.nextdoc, ptl.linktype, BUILTIN.DF(ptl.nextdoc) AS siguiente
FROM previoustransactionlink ptl
WHERE ptl.previousdoc = 123456
```

#### Columnas observadas

**`transactionaccountingline`** · volumen alto, filtrar siempre · 18 columnas observadas

`account` (entero), `accountingbook` (entero), `accounttype` (texto), `amount` (decimal), `amountlinked` (decimal), `exchangerate` (decimal), `grossamount` (decimal), `netamount` (decimal), `posting` (T/F), `transaction` (entero), `transactionline` (entero), `credit` (decimal), `paymentamountunused` (entero), `paymentamountused` (decimal), `debit` (decimal), `amountpaid` (decimal), `amountunpaid` (decimal), `processedbyrevcommit` (T/F)

**`journalentry`** · ≥ 25.000 filas · 33 columnas observadas

`approved` (T/F), `createdby` (entero), `createddate` (fecha), `credittotal` (decimal), `currency` (entero), `custbody_adjustment_journal` (T/F), `custbody_cash_register` (T/F), `custbody_kis_error_cronologico` (T/F), `custbody_kis_tipo_de_documento` (entero), `custbody_ks_siigo_clasificacion_je` (entero), `custbody_ph4014_wtax_reversal_flag` (T/F), `custbody_report_timestamp` (fecha-hora), `debittotal` (decimal), `department` (entero), `externalid` (texto), `id` (entero), `intercoadj` (T/F), `isbookspecific` (T/F), `isreversal` (T/F), `lastmodifiedby` (entero), `lastmodifieddate` (fecha), `memo` (texto), `posting` (T/F), `postingperiod` (entero), `primarybookbasecurrency` (entero), `status` (texto), `subsidiary` (entero), `taxperiod` (entero), `trandate` (fecha), `tranid` (entero), `transactionnumber` (texto), `void` (T/F), `accountingbook` (entero)

`transaction` (212 columnas observadas) y `transactionline` (98) son demasiado anchas para listarlas aquí: corre `SELECT * FROM transaction WHERE ROWNUM <= 5` en la consola para verlas todas, incluidos los `custbody_*` y `custcol_*` de Siigo.

### Plan de cuentas, periodos y libros

```suiteql
SELECT a.id, a.acctnumber, a.fullname, a.accttype, a.issummary, a.isinactive,
       BUILTIN.DF(a.currency) AS moneda
FROM account a
WHERE a.isinactive = 'F'
ORDER BY a.acctnumber
```

```suiteql
SELECT id, periodname, startdate, enddate, closed, alllocked
FROM accountingperiod
WHERE isquarter = 'F' AND isyear = 'F' AND startdate >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
ORDER BY startdate
```

**`account`** · 2.240 filas · 24 columnas observadas

`accountsearchdisplayname` (texto), `accountsearchdisplaynamecopy` (texto), `accttype` (texto), `balance` (decimal), `cashflowrate` (texto), `displaynamewithhierarchy` (texto), `eliminate` (T/F), `fullname` (texto), `generalrate` (texto), `id` (entero), `includechildren` (T/F), `inventory` (T/F), `isinactive` (T/F), `issummary` (T/F), `lastmodifieddate` (fecha), `reconcilewithmatching` (T/F), `revalue` (T/F), `sspecacct` (texto), `subsidiary` (texto), `acctnumber` (texto), `currency` (entero), `externalid` (texto), `fxbalance` (entero), `description` (texto)

**`accountingperiod`** · 342 filas · 16 columnas observadas

`alllocked` (T/F), `allownonglchanges` (T/F), `aplocked` (T/F), `arlocked` (T/F), `closed` (T/F), `closedondate` (fecha), `enddate` (fecha), `id` (entero), `isadjust` (T/F), `isinactive` (T/F), `isposting` (T/F), `isquarter` (T/F), `isyear` (T/F), `lastmodifieddate` (fecha), `periodname` (texto), `startdate` (fecha)

**`accountingbook`** · 2 filas · 13 columnas observadas

`contingentrevenuehandling` (T/F), `createddate` (fecha), `effectiveperiod` (entero), `id` (entero), `includechildren` (T/F), `isadjustmentonly` (T/F), `isconsolidated` (T/F), `isprimary` (T/F), `lastmodifieddate` (fecha), `name` (texto), `status` (texto), `twosteprevenueallocation` (T/F), `unbilledreceivablegrouping` (texto)

**`accounttype`** · 20 filas · 12 columnas observadas

`balancesheet` (T/F), `defaultcashflowratetype` (texto), `defaultgeneralratetype` (texto), `defaultlongname` (texto), `id` (texto), `includeinrevaldefault` (T/F), `internalid` (entero), `left` (T/F), `longname` (texto), `seqnum` (entero), `usercanchangerevaloption` (T/F), `eliminationalgo` (texto)

### Estructura organizacional

Subsidiarias, departamentos, clases y ubicaciones. Además hay **segmentos personalizados** de Siigo en las líneas (`cseg_ks_siigo_linea`, `cseg_ks_siigo_mon1`, `cseg_ks_siigo_mont2`); `BUILTIN.DF(columna)` da su nombre.

```suiteql
SELECT id, name, fullname, BUILTIN.DF(parent) AS padre, isinactive
FROM department
ORDER BY fullname
```

**`subsidiary`** · 13 filas · 41 columnas observadas

`country` (texto), `currency` (entero), `custrecord_atlas_prowb_translations` (entero), `custrecord_enviroment_develop` (T/F), `custrecord_psg_ei_disable_country` (T/F), `custrecord_psg_lc_test_mode` (texto), `dropdownstate` (texto), `edition` (texto), `fiscalcalendar` (entero), `fullname` (texto), `id` (entero), `iselimination` (T/F), `isinactive` (T/F), `languagelocale` (texto), `lastmodifieddate` (fecha), `legalname` (texto), `mainaddress` (entero), `name` (texto), `parent` (entero), `requirepejememo` (T/F), `showsubsidiaryname` (T/F), `state` (texto), `taxfiscalcalendar` (entero), `federalidnumber` (texto), `email` (texto), `fax` (texto), `url` (texto), `custrecord_psg_ei_license_free_country` (entero), `custrecord_url_send_payment_synergy` (texto), `tranprefix` (texto), `custrecord_b64_certificate_mx` (texto), `custrecord_b64_certificate_mx2` (texto), `custrecord_b64_certificate_mx3` (texto), `custrecord_codigo_postal_mx` (entero), `custrecord_mx_num_certificate` (entero), `custrecord_mx_sat_industry_type` (entero), `custrecord_mx_sat_registered_name` (texto), `custrecord_psg_ei_email_custom` (entero), `custrecord_psg_ei_sender` (entero), `custrecord_url_payment_dev` (texto), `custrecord_url_payment_prod` (texto)

**`department`** · 356 filas · 9 columnas observadas

`custrecord_ks_gn_depmovimiento` (T/F), `fullname` (texto), `id` (entero), `includechildren` (T/F), `isinactive` (T/F), `lastmodifieddate` (fecha), `name` (texto), `subsidiary` (texto), `parent` (entero)

**`classification`** · 174 filas · 7 columnas observadas

`fullname` (texto), `id` (entero), `includechildren` (T/F), `isinactive` (T/F), `lastmodifieddate` (fecha), `name` (texto), `subsidiary` (texto)

**`location`** · 63 filas · 12 columnas observadas

`custrecord_5826_loc_branch_id` (entero), `externalid` (entero), `fullname` (texto), `id` (entero), `isinactive` (T/F), `lastmodifieddate` (fecha), `mainaddress` (entero), `makeinventoryavailable` (T/F), `makeinventoryavailablestore` (T/F), `name` (texto), `subsidiary` (entero), `timezone` (texto)

### Monedas y tasas de cambio

```suiteql
SELECT effectivedate, BUILTIN.DF(basecurrency) AS base,
       BUILTIN.DF(transactioncurrency) AS moneda, exchangerate
FROM currencyrate
WHERE effectivedate >= TO_DATE('2026-10-01', 'YYYY-MM-DD')
ORDER BY effectivedate DESC
```

**`currency`** · 9 filas · 11 columnas observadas

`currencyprecision` (entero), `displaysymbol` (texto), `exchangerate` (decimal), `id` (entero), `isbasecurrency` (T/F), `isinactive` (T/F), `name` (texto), `overridecurrencyformat` (T/F), `symbol` (texto), `symbolplacement` (entero), `lastmodifieddate` (fecha)

**`currencyrate`** · 12.193 filas · 7 columnas observadas

`basecurrency` (entero), `effectivedate` (fecha), `exchangerate` (decimal), `id` (entero), `lastmodifedby` (entero), `lastmodifieddate` (fecha), `transactioncurrency` (entero)

**`consolidatedexchangerate`** · 17.784 filas · 15 columnas observadas

`accountingbook` (entero), `averagerate` (entero), `currentrate` (entero), `fromcurrency` (entero), `fromsubsidiary` (entero), `historicalrate` (entero), `id` (entero), `isderived` (T/F), `iseliminationsubsidiary` (T/F), `isperiodclosed` (T/F), `periodenddate` (fecha), `periodstartdate` (fecha), `postingperiod` (entero), `tocurrency` (entero), `tosubsidiary` (entero)

### Terceros: clientes, proveedores, empleados

`entity` reúne a todos los terceros (columna `type`); cada tipo tiene además su tabla con los campos propios, incluidos los de localización (`custentity_ks_documento`, `custentity_ks_digitoverificacion`, `custentity_mx_rfc`, `custentity_ks_tipo_doc_identidad`…).

**Datos personales:** estas tablas traen correos, documentos de identidad, fechas de nacimiento y datos de nómina. Pedir solo las columnas necesarias y no guardarlas fuera de NetSuite sin una razón.

```suiteql
SELECT id, entityid, companyname, custentity_ks_documento, BUILTIN.DF(subsidiary) AS subsidiaria
FROM vendor
WHERE isinactive = 'F' AND ROWNUM <= 50
```

`customer` tiene 1.175.853 filas y `SELECT *` sin filtro agota el tiempo: siempre filtrar (por `id`, `entityid`, `datecreated`, `lastmodifieddate` o subsidiaria).

**`entity`** · ≥ 25.000 filas · 25 columnas observadas

`altname` (texto), `contact` (entero), `customer` (entero), `datecreated` (fecha), `email` (texto), `employee` (entero), `entityid` (texto), `entitytitle` (texto), `externalid` (texto), `fullname` (texto), `group` (entero), `id` (entero), `isinactive` (T/F), `isperson` (T/F), `isunavailable` (T/F), `lastmodifieddate` (fecha), `othername` (entero), `phone` (entero), `project` (entero), `subsidiary` (entero), `toplevelparent` (entero), `type` (texto), `vendor` (entero), `source` (texto), `parent` (entero)

**`contact`** · ≥ 25.000 filas · 15 columnas observadas

`company` (entero), `datecreated` (fecha), `duplicate` (T/F), `email` (texto), `emailpreference` (texto), `entityid` (texto), `entitytitle` (texto), `fullname` (texto), `id` (entero), `isinactive` (T/F), `isprivate` (T/F), `lastmodifieddate` (fecha), `loginaccess` (T/F), `owner` (entero), `subsidiary` (entero)

**`entityaddress`** · ≥ 25.000 filas · 13 columnas observadas

`addressee` (texto), `addrtext` (texto), `country` (texto), `lastmodifieddate` (fecha), `nkey` (entero), `override` (T/F), `recordowner` (entero), `addr1` (texto), `city` (texto), `dropdownstate` (texto), `state` (texto), `zip` (entero), `custrecord_streetname` (texto)

**`customersubsidiaryrelationship`** · volumen alto, filtrar siempre · 10 columnas observadas

`balance` (entero), `depositbalance` (entero), `entity` (entero), `id` (entero), `isprimarysub` (T/F), `lastmodifieddate` (fecha), `name` (texto), `primarycurrency` (entero), `subsidiary` (entero), `unbilledorders` (entero)

**`vendorsubsidiaryrelationship`** · 12.176 filas · 14 columnas observadas

`balance` (entero), `balancebase` (entero), `basecurrency` (entero), `entity` (entero), `id` (entero), `isprimarysub` (T/F), `lastmodifieddate` (fecha), `name` (texto), `prepaymentbalance` (entero), `prepaymentbalancebase` (entero), `primarycurrency` (entero), `subsidiary` (entero), `unbilledorders` (decimal), `unbilledordersbase` (decimal)

`vendor` (82 columnas), `employee` (58) y `customer` (106) son anchas; revísalas en la consola con `WHERE ROWNUM <= 5`.

### Ítems

```suiteql
SELECT id, itemid, itemtype, BUILTIN.DF(incomeaccount) AS cuenta_ingreso, isinactive
FROM item
WHERE isinactive = 'F'
```

`item` cubre todos los tipos. Las vistas por tipo que existen: `inventoryitem`, `kititem`, `itemgroup`, `noninventorysaleitem`, `noninventorypurchaseitem`, `noninventoryresaleitem`, `servicesaleitem`, `servicepurchaseitem`, `serviceresaleitem`, `otherchargesaleitem`, `otherchargepurchaseitem`, `otherchargeresaleitem`, `discountitem`, `markupitem`, `paymentitem`, `subtotalitem`, `descriptionitem`, `shipitem`.

### Ingresos diferidos y amortizaciones

Revenue management (elementos y planes de ingreso) y calendarios de amortización. Útiles para cruces como el de cálculo de comisiones.

```suiteql
SELECT rp.recordnumber, rp.revrecstartdate, rp.revrecenddate, rp.amount,
       rp.totalrecognized, rp.remainingdeferredbalance, BUILTIN.DF(rp.item) AS item
FROM revenueplan rp
WHERE rp.revrecstartdate >= TO_DATE('2026-01-01', 'YYYY-MM-DD') AND ROWNUM <= 100
```

**`revenueplan`** · ≥ 25.000 filas · 31 columnas observadas

`accountingbook` (entero), `amount` (decimal), `amountsource` (texto), `createddate` (fecha), `createdfrom` (entero), `creationtriggeredbydisplay` (texto), `exchangerate` (decimal), `holdrevenuerecognition` (T/F), `id` (entero), `iseliminate` (T/F), `item` (entero), `lastmodifieddate` (fecha), `parentlinecurrency` (texto), `recognitionmethod` (texto), `recognitionperiod` (entero), `recordnumber` (entero), `reforecastmethod` (texto), `revenueplancurrency` (texto), `revenueplantype` (texto), `revenuerecognitionrule` (entero), `revrecenddate` (fecha), `revrecenddatesource` (texto), `revrecstartdate` (fecha), `revrecstartdatesource` (texto), `totalrecognized` (entero), `enddatechangeimpactfordisplay` (texto), `remainingdeferredbalance` (decimal), `statusfordisplay` (texto), `periodoffset` (entero), `comments` (texto), `custrecord_sg_end_date` (fecha)

**`amortizationschedule`** · 3.169 filas · 37 columnas observadas

`accountingbook` (entero), `amortizationperiod` (entero), `amortizationtype` (texto), `basecurrencyprecision` (entero), `currency` (entero), `destinationaccount` (entero), `enddate` (fecha), `id` (entero), `initialamount` (entero), `isamortization` (T/F), `iseliminate` (T/F), `isinactive` (T/F), `isrecognized` (T/F), `isschedule` (T/F), `linesequencenumber` (entero), `name` (entero), `parentsched` (entero), `percentrecognition` (decimal), `periodoffset` (entero), `recogintervalsrc` (texto), `recuramount` (decimal), `recurfxamount` (decimal), `recurrencetype` (texto), `remainingdeferredbalance` (entero), `residual` (entero), `revrecoffset` (entero), `schedulenumber` (entero), `sourceaccount` (entero), `sourcetran` (entero), `sourcetranpostingperiod` (entero), `startdate` (fecha), `status` (texto), `subsidiary` (entero), `totalamortized` (decimal), `totalamount` (decimal), `tranlineid` (entero), `trantype` (texto)

`revenueelement` (55 columnas) completa el modelo con montos asignados, valor razonable y segmentos.

### Presupuesto, banca e impuestos

| Tablas | Qué traen |
|---|---|
| `budgets`, `budgetcategory`, `budgetexchangerate` | Presupuesto por cuenta, año, departamento y subsidiaria (`budget` y `budgetimport` no sirven para consultar montos) |
| `bankingtransaction`, `bankingstatement`, `bankrecsuggestion`, `transactionmatch` | Extractos importados, sugerencias y cruces de la conciliación bancaria nativa |
| `salestaxitem`, `taxgroup`, `taxtype`, `taxacct`, `taxschedule`, `nexus` | Códigos de impuesto, grupos, tipos y nexos fiscales |
| `term`, `paymentmethod` | Condiciones de pago y medios de pago |

```suiteql
SELECT b.year, BUILTIN.DF(b.account) AS cuenta, BUILTIN.DF(b.department) AS departamento,
       BUILTIN.DF(b.subsidiary) AS subsidiaria, b.total
FROM budgets b
WHERE ROWNUM <= 100
```

**`budgets`** · 162 filas · 11 columnas observadas

`account` (entero), `accountingbook` (entero), `budgettype` (T/F), `category` (entero), `currency` (entero), `department` (entero), `id` (entero), `lastmodifieddate` (fecha), `subsidiary` (entero), `total` (entero), `year` (entero)

**`bankingtransaction`** · ≥ 25.000 filas · 13 columnas observadas

`account` (entero), `amount` (decimal), `bankingimport` (entero), `customerid` (entero), `customername` (texto), `documentnumber` (texto), `excluded` (T/F), `id` (entero), `payee` (texto), `transactiondate` (fecha), `transactiontype` (texto), `duplicateof` (entero), `memo` (texto)

### Personalizaciones: campos, listas y registros

Siigo tiene 5.219 campos personalizados, 201 listas y 406 registros personalizados legibles (ver anexos). Para saber qué significa un `custbody_*`, `custcol_*`, `custentity_*` o `custrecord_*`:

```suiteql
SELECT scriptid, name, fieldtype, fieldvaluetype, description
FROM customfield
WHERE LOWER(scriptid) LIKE 'custbody_ks%'
```

Valores de una lista personalizada (cada lista es una tabla con su `scriptid` en minúscula):

```suiteql
SELECT id, name, isinactive FROM customlist_ks_tipo_cuenta
```

Un registro personalizado se consulta igual, por su `scriptid`:

```suiteql
SELECT * FROM customrecord_ks_exogenos WHERE ROWNUM <= 20
```

**`customfield`** · 5.219 filas · 18 columnas observadas

`fieldtype` (texto), `fieldvaluetype` (texto), `fieldvaluetyperecord` (entero), `id` (entero), `internalid` (entero), `ismandatory` (T/F), `isshowinlist` (T/F), `isstored` (T/F), `lastmodifieddate` (fecha), `name` (texto), `owner` (entero), `scriptid` (texto), `description` (texto), `recordtype` (entero), `aidescription` (texto), `source` (texto), `tab` (texto), `visibleontransactions` (texto)

**`customlist`** · 200 filas · 10 columnas observadas

`frombundle` (texto), `hiddenbundlecomponent` (T/F), `internalid` (entero), `isinactive` (T/F), `isordered` (T/F), `lastmodifieddate` (fecha), `name` (texto), `owner` (entero), `scriptid` (texto), `description` (texto)

### Auditoría y archivos

| Tabla | Qué trae | Ojo |
|---|---|---|
| `systemnote` | Historial de cambios: campo, valor anterior y nuevo, quién, cuándo, contexto (UI, script, REST…) | **Muy lenta**: con filtro de fecha tardó ~80 s. Filtrar por `recordid` o `recordtypeid` además de la fecha |
| `deletedrecord` | Registros borrados: tipo, id, fecha, quién | Filtrar por fecha |
| `file` | Archivos del File Cabinet: nombre, carpeta, tamaño, tipo, URL | El contenido del archivo no sale por SuiteQL |
| `loginaudittrail` | — | No es consultable por SuiteQL |

```suiteql
SELECT date, BUILTIN.DF(name) AS usuario, field, oldvalue, newvalue, context
FROM systemnote
WHERE recordid = 123456 AND date >= TO_DATE('2026-11-01', 'YYYY-MM-DD')
```

## Lo que no devuelve y los límites

La sección para responder "¿se puede?" con honestidad.

### No disponible

- **Transacciones personalizadas** (`customtransaction_*`): no existen como tablas. Se leen en `transaction` con `type = 'Custom'` y se distinguen por `customtype` (unas 59.000 filas).
- **Definiciones de registros personalizados** (`customrecordtype`), **roles** (`role`), **scripts** (`script`, `scriptdeployment`): no visibles para este rol. Para la lista de registros personalizados usa el metadata catalog o el anexo.
- **Búsquedas guardadas**: no se pueden ejecutar desde REST ni SuiteQL; hay que reescribir la lógica en SuiteQL.
- **Contenido de archivos** del File Cabinet, **PDFs** de transacciones y **reportes financieros nativos** (balance, P&G): no salen por estos canales. Los saldos se reconstruyen sumando `transactionaccountingline`.
- **Escribir**: SuiteQL responde `Not a select statement` a `UPDATE`, `INSERT` o `DELETE`. La escritura por REST Record API no se probó.
- Las tablas del anexo "Tablas que no responden" no existen en la cuenta o el rol no las ve (inventario avanzado, suscripciones, cupones, timesheets, revenue recognition clásico…).

### Límites de SuiteQL

| Límite | Detalle | Qué hacer |
|---|---|---|
| 100.000 filas por consulta | Con `offset` no se pasa de ahí | Partir por rango de fechas o por id |
| 1.000 filas por página | `limit` máximo | El cliente pagina solo (`runSuiteQL`, `suiteQLPageAt`) |
| Paginación inestable | Sin `ORDER BY` por una clave numérica única, NetSuite puede repetir o saltar filas entre páginas | `ORDER BY id` (o `t.id, tl.id`) |
| `totalResults` con tope | En tablas enormes sin filtro, el total reportado se queda en `limit × 1.000` (5.000 con `limit=5`, 25.000 con `limit=25`) | Usar `COUNT(*)` para contar |
| `SELECT *` sin filtro en tablas grandes | `transactionline`, `transactionaccountingline`, `customer`, `systemnote`, `file`, `cashsale`… agotan el tiempo | Siempre `WHERE` por fecha o id, o `ROWNUM <= n` para explorar |
| `ORDER BY COUNT(*)` | Devuelve error 500 de NetSuite | Ordenar en el cliente |
| Concurrencia | Varias consultas pesadas a la vez devuelven `429` | El cliente reintenta con backoff; en lotes, máximo 4 en paralelo |
| `SELECT *` en `expensereport` | Falla por un campo interno (`acctcorpcardexp`) | Listar columnas explícitas |

### Formato de los datos

- **Todo llega como texto**, incluidos números y fechas. Hay que convertir.
- **Fechas en dd/mm/aaaa** (preferencia regional del usuario de la integración). Para filtrar usa `TO_DATE('2026-10-01', 'YYYY-MM-DD')`.
- **Booleanos** como `'T'` / `'F'`.
- **Columnas vacías se omiten** de cada fila. El cliente del portal las completa con `null` cuando se le pasa la lista de columnas.
- **Ids, no nombres**: las referencias (cuenta, tercero, departamento) vienen como id interno. `BUILTIN.DF(columna)` devuelve el texto que muestra NetSuite, en español.
- **Permisos silenciosos**: si el rol no puede ver un campo, el campo simplemente no aparece. Una columna ausente puede ser "vacía en la muestra" o "sin permiso"; para distinguirlo, pide la columna por nombre: si no existe o no hay permiso, NetSuite responde error.

### REST Record API

- **Detalle exige `Accept-Language: en`.** Sin el header responde `400 Invalid language`, porque el usuario de la integración tiene el español como preferencia y REST solo acepta el idioma por defecto de la compañía (inglés). Con `es` responde `406`. El cliente del portal **no envía este header hoy**: si se va a leer el detalle de registros por REST, hay que agregarlo en `fetchWithRetry`.
- Los nombres de campo son **camelCase** (`acctName`, `tranDate`) y no coinciden con los de SuiteQL (`acctname`, `trandate`).
- Listar admite filtros: `GET /record/v1/invoice?q=tranDate ON_OR_AFTER "01/10/2026"`. Para lectura masiva conviene más SuiteQL.
- 19 tipos del catálogo no listan; la mayoría son módulos no activos y tres son ítems lote/serie con un campo retirado por NetSuite.

## Cómo decidir si un requerimiento se puede

1. **Ubica el dato en NetSuite** (pantalla y campo). En la UI, el id del campo aparece al pasar el mouse por la etiqueta si está activado "Mostrar ids internos".
2. **Busca la tabla** en este documento o en los anexos. Si es un campo personalizado, búscalo en `customfield` por `scriptid` o por nombre.
3. **Pruébalo en la consola** con `WHERE ROWNUM <= 20`. Si la columna aparece con datos, se puede.
4. **Mide el volumen** con `COUNT(*)` y el filtro real. Más de 100.000 filas implica partir la consulta.
5. Si la tabla no existe o el campo no aparece: revisa la sección *No disponible*. Si no está ahí, probablemente es **permiso del rol**: hay que pedir al administrador de NetSuite que lo amplíe.
6. Si el requerimiento es **escribir** en NetSuite, no hay nada en el portal que lo haga hoy: hace falta validar permisos del rol y probar la REST Record API (o un RESTlet) en sandbox.

## Anexo A · Tablas estándar legibles

140 tablas. "Filas" es lo que NetSuite reportó en el sondeo; "≥ 25.000" significa que el total superó el tope de conteo (usa `COUNT(*)`).

| Tabla | Filas | Columnas observadas |
|---|---|---|
| `account` | 2.240 | 24 |
| `accountingbook` | 2 | 13 |
| `accountingperiod` | 342 | 16 |
| `accountsubsidiarymap` | 9.551 | 2 |
| `accounttype` | 20 | 12 |
| `advintercompanyjournalentry` | 0 | 0 |
| `amortizationschedule` | 3.169 | 37 |
| `bankingstatement` | 31 | 4 |
| `bankingtransaction` | ≥ 25.000 | 13 |
| `bankrecsuggestion` | 0 | 0 |
| `billingrevenueevent` | 0 | 0 |
| `billingschedule` | 0 | 0 |
| `blanketpurchaseorder` | 4 | 97 |
| `budgetcategory` | 7 | 4 |
| `budgetexchangerate` | 17.784 | 15 |
| `budgetimport` | 162 | 21 |
| `budgets` | 162 | 11 |
| `calendarevent` | 0 | 0 |
| `cashrefund` | 0 | 0 |
| `cashsale` | muy grande (filtrar) | 143 |
| `check` | 15.259 | 85 |
| `classification` | 174 | 7 |
| `competitor` | 0 | 0 |
| `consolidatedexchangerate` | 17.784 | 15 |
| `contact` | ≥ 25.000 | 15 |
| `contactcategory` | 0 | 0 |
| `contactrole` | 5 | 3 |
| `country` | 254 | 8 |
| `creditcardrefund` | 0 | 0 |
| `creditmemo` | ≥ 25.000 | 148 |
| `currency` | 9 | 11 |
| `currencyrate` | 12.193 | 7 |
| `customer` | muy grande (filtrar) | 106 |
| `customercategory` | 0 | 0 |
| `customerdeposit` | ≥ 25.000 | 28 |
| `customermessage` | 5 | 4 |
| `customerpayment` | ≥ 25.000 | 33 |
| `customerrefund` | ≥ 25.000 | 33 |
| `customersubsidiaryrelationship` | muy grande (filtrar) | 10 |
| `customfield` | 5.219 | 18 |
| `deletedrecord` | muy grande (filtrar) | 12 |
| `department` | 356 | 9 |
| `depositapplication` | ≥ 25.000 | 30 |
| `descriptionitem` | 1 | 9 |
| `discountitem` | 186 | 11 |
| `emailtemplate` | 13 | 15 |
| `employee` | 12.746 | 58 |
| `entity` | ≥ 25.000 | 25 |
| `entityaddress` | ≥ 25.000 | 13 |
| `entitygroup` | 10 | 14 |
| `entitystatus` | 17 | 7 |
| `expense` | 0 | 0 |
| `expensecategory` | 201 | 8 |
| `fairvalueformula` | 0 | 0 |
| `fairvalueprice` | 0 | 0 |
| `file` | muy grande (filtrar) | 16 |
| `giftcertificate` | 0 | 0 |
| `inboundshipment` | 0 | 0 |
| `intercompanytransferorder` | 0 | 0 |
| `inventoryadjustment` | 5.279 | 25 |
| `inventoryitem` | 690 | 74 |
| `inventorytransfer` | 129 | 27 |
| `invoice` | ≥ 25.000 | 158 |
| `item` | 7.058 | 80 |
| `itemcollection` | 0 | 0 |
| `itemfulfillment` | 16.396 | 41 |
| `itemgroup` | 0 | 0 |
| `itemreceipt` | 478 | 25 |
| `job` | 0 | 0 |
| `jobstatus` | 5 | 5 |
| `jobtype` | 0 | 0 |
| `journalentry` | ≥ 25.000 | 33 |
| `kititem` | 0 | 0 |
| `leadsource` | 5 | 5 |
| `location` | 63 | 12 |
| `markupitem` | 0 | 0 |
| `mediaitemfolder` | 1.081 | 16 |
| `message` | ≥ 25.000 | 23 |
| `nexttransactionlink` | ≥ 25.000 | 3 |
| `nexus` | 5 | 5 |
| `noninventorypurchaseitem` | 3 | 21 |
| `noninventoryresaleitem` | 0 | 0 |
| `noninventorysaleitem` | 5.960 | 55 |
| `notetype` | 8 | 4 |
| `otherchargepurchaseitem` | 0 | 0 |
| `otherchargeresaleitem` | 0 | 0 |
| `otherchargesaleitem` | 4 | 26 |
| `othername` | 0 | 0 |
| `othernamecategory` | 0 | 0 |
| `partnercategory` | 0 | 0 |
| `paymentadjustment` | 4 | 5 |
| `paymentitem` | 0 | 0 |
| `paymentmethod` | 6 | 5 |
| `paymentrun` | 0 | 0 |
| `periodendjournal` | 33 | 24 |
| `phonecall` | 0 | 0 |
| `previoustransactionlinelink` | muy grande (filtrar) | 12 |
| `previoustransactionlink` | ≥ 25.000 | 3 |
| `pricelevel` | 22 | 5 |
| `pricinggroup` | 0 | 0 |
| `purchasecontract` | 11 | 92 |
| `purchaseorder` | 8.998 | 98 |
| `purchaserequisition` | 6.547 | 95 |
| `revenueelement` | ≥ 25.000 | 55 |
| `revenueplan` | ≥ 25.000 | 31 |
| `revrecfieldmapping` | 0 | 0 |
| `salesorder` | 16.620 | 117 |
| `salestaxitem` | 76 | 66 |
| `savedsearch` | 1.570 | 14 |
| `servicepurchaseitem` | 213 | 22 |
| `serviceresaleitem` | 0 | 0 |
| `servicesaleitem` | 1 | 35 |
| `shipitem` | 3 | 7 |
| `sitecategory` | 1 | 11 |
| `state` | 302 | 4 |
| `statisticaljournalentry` | 0 | 0 |
| `subsidiary` | 13 | 41 |
| `subtotalitem` | 0 | 0 |
| `task` | 2 | 20 |
| `taxacct` | 16 | 7 |
| `taxgroup` | 2 | 0 |
| `taxschedule` | 4 | 4 |
| `taxtype` | 30 | 5 |
| `term` | 41 | 13 |
| `timebill` | 0 | 0 |
| `transaction` | ≥ 25.000 | 212 |
| `transactionaccountingline` | muy grande (filtrar) | 18 |
| `transactionaddressbook` | ≥ 25.000 | 6 |
| `transactionline` | muy grande (filtrar) | 98 |
| `transactionmatch` | muy grande (filtrar) | 5 |
| `transactionstatus` | 355 | 6 |
| `transferorder` | 0 | 0 |
| `vendor` | 11.945 | 82 |
| `vendorbill` | ≥ 25.000 | 124 |
| `vendorcategory` | 4 | 4 |
| `vendorcredit` | 1.052 | 124 |
| `vendorpayment` | ≥ 25.000 | 34 |
| `vendorprepayment` | 132 | 117 |
| `vendorsubsidiaryrelationship` | 12.176 | 14 |
| `winlossreason` | 0 | 0 |

## Anexo B · Registros personalizados legibles

406 tablas `customrecord_*`. Las que tienen 0 filas existen pero están vacías.

| Tabla | Filas | Columnas observadas |
|---|---|---|
| `customrecord200` | 0 | 0 |
| `customrecord202` | 0 | 0 |
| `customrecord2523` | 63 | 12 |
| `customrecord_2663_bill_eft_details` | 0 | 0 |
| `customrecord_2663_execution_log` | 0 | 0 |
| `customrecord_2digit_account_values` | 74 | 12 |
| `customrecord_3k_config_ui` | 1 | 12 |
| `customrecord_3k_forma_pago_local` | 1 | 15 |
| `customrecord_4599` | 62 | 22 |
| `customrecord_4599_sys_note` | 167 | 12 |
| `customrecord_4599_tranchild` | 0 | 0 |
| `customrecord_4601_groupedwitaxcode` | 960 | 12 |
| `customrecord_4601_witaxcode` | 621 | 22 |
| `customrecord_4601_witaxconfiguration` | 0 | 0 |
| `customrecord_4601_witaxsetup` | 4 | 22 |
| `customrecord_4601_witaxtype` | 93 | 18 |
| `customrecord_4digit_account_values` | 739 | 12 |
| `customrecord_8299_client_audit_trail` | ≥ 25.000 | 14 |
| `customrecord_8299_license_cache` | 22.056 | 18 |
| `customrecord_8299_license_server` | 1 | 12 |
| `customrecord_application_payment` | 2.447 | 16 |
| `customrecord_aser_param_int` | 0 | 0 |
| `customrecord_atlas_proworkbook_strings` | 1 | 12 |
| `customrecord_bancos_davivienda` | 65 | 11 |
| `customrecord_bf_audittrail` | 0 | 0 |
| `customrecord_bf_ns_prod_consent_id` | 0 | 0 |
| `customrecord_bf_se_customer_id` | 1 | 11 |
| `customrecord_bf_se_excluded_accounts` | 0 | 0 |
| `customrecord_bf_se_next_transaction_id` | 0 | 0 |
| `customrecord_bf_ydl_accept` | 0 | 0 |
| `customrecord_bodega_synergy` | 163 | 10 |
| `customrecord_co_ks_concepto` | 135 | 10 |
| `customrecord_co_ks_formato` | 11 | 9 |
| `customrecord_codes_error_api_davivienda` | 42 | 11 |
| `customrecord_conf_monit_scripts` | 7 | 10 |
| `customrecord_config_servicios_mx` | 2 | 46 |
| `customrecord_control_siigo_pay` | 12 | 17 |
| `customrecord_control_siigo_pay_out` | 0 | 0 |
| `customrecord_country` | 0 | 0 |
| `customrecord_cs_codigos_de_diagnostico` | 0 | 0 |
| `customrecord_csaf_loqate_analytics` | 1 | 11 |
| `customrecord_csaf_state_list` | 110 | 11 |
| `customrecord_cseg_ks_siigo_linea` | 209 | 9 |
| `customrecord_cseg_ks_siigo_mon1` | 97 | 9 |
| `customrecord_cseg_ks_siigo_mont2` | 42 | 9 |
| `customrecord_cseg_ksco_class_exo` | 7 | 9 |
| `customrecord_csegtipo_de_vta_uy` | 3 | 9 |
| `customrecord_data_odbc_connect` | 1 | 14 |
| `customrecord_detalle_pagos_api_col` | 10 | 26 |
| `customrecord_dian_account_config` | 645 | 14 |
| `customrecord_dian_categoria` | 19 | 10 |
| `customrecord_ecsl_audit_trail_dtl` | 0 | 0 |
| `customrecord_ecsl_audit_trail_hdr` | 0 | 0 |
| `customrecord_ei_automation_pref` | 1 | 10 |
| `customrecord_ei_ctt_map` | 1 | 9 |
| `customrecord_ei_peppol_tax_exempt_codes` | 87 | 11 |
| `customrecord_ei_sending_method` | 10 | 17 |
| `customrecord_encryption_details` | 0 | 0 |
| `customrecord_ep_company_information` | 0 | 0 |
| `customrecord_erp_act_data_config` | 2 | 15 |
| `customrecord_fel_ecu` | 1 | 21 |
| `customrecord_filing_config` | 2 | 13 |
| `customrecord_filing_template` | 13 | 10 |
| `customrecord_gd_tipodocumento` | 7 | 10 |
| `customrecord_income_statement_1167` | 168 | 11 |
| `customrecord_income_statement_1175` | 102 | 11 |
| `customrecord_income_statement_1323` | 185 | 11 |
| `customrecord_intrastat_region` | 124 | 13 |
| `customrecord_iso_customized_templates` | 0 | 0 |
| `customrecord_itr_system_parameter` | 5 | 10 |
| `customrecord_kis_libraries` | 20 | 40 |
| `customrecord_kis_serie_config` | 8 | 15 |
| `customrecord_kis_serie_detalle` | ≥ 25.000 | 17 |
| `customrecord_kis_serie_segurity` | ≥ 25.000 | 11 |
| `customrecord_kis_series` | 83 | 31 |
| `customrecord_kis_si_tipo_doc` | 47 | 10 |
| `customrecord_kis_tcrp_wh_iva_ret` | 33 | 17 |
| `customrecord_kis_transaction_types` | 36 | 14 |
| `customrecord_ks06_format_conceptos_dian` | 0 | 0 |
| `customrecord_ks_acc_type_bancolombia` | 2 | 9 |
| `customrecord_ks_acc_type_bbog` | 3 | 9 |
| `customrecord_ks_acc_type_davivienda` | 4 | 9 |
| `customrecord_ks_actividadeseconomicas` | 930 | 18 |
| `customrecord_ks_adquisiciones_and_paymen` | 11 | 16 |
| `customrecord_ks_agente_reteiva_104` | 6 | 11 |
| `customrecord_ks_amount_to_words_config` | 10 | 19 |
| `customrecord_ks_at_comp_anulados` | 54 | 15 |
| `customrecord_ks_at_estab_ruc` | 1 | 10 |
| `customrecord_ks_ats_cod_regimen` | 9 | 10 |
| `customrecord_ks_ats_distrito_aduanero` | 14 | 10 |
| `customrecord_ks_ats_pais` | 258 | 11 |
| `customrecord_ks_ats_tipo_de_pago` | 2 | 10 |
| `customrecord_ks_ats_tipoing_ext` | 39 | 10 |
| `customrecord_ks_banco_cuenta_benef_bbog` | 36 | 9 |
| `customrecord_ks_banco_cuenta_benef_bcolo` | 36 | 9 |
| `customrecord_ks_banco_cuenta_benef_davi` | 37 | 9 |
| `customrecord_ks_banco_vs_cuentas` | 38 | 13 |
| `customrecord_ks_clas_tax_co` | 43 | 11 |
| `customrecord_ks_clase_tran_bancolombia` | 10 | 9 |
| `customrecord_ks_co_ei_whttax_codes` | 84 | 13 |
| `customrecord_ks_co_electronic_invoicing` | 1 | 13 |
| `customrecord_ks_co_parameters_mb_reports` | 6 | 23 |
| `customrecord_ks_co_tax_codes_by_type` | 369 | 16 |
| `customrecord_ks_codigoentbancaria_bi` | 502 | 9 |
| `customrecord_ks_config_facturacion_elect` | 3 | 40 |
| `customrecord_ks_consecutive_type` | 0 | 0 |
| `customrecord_ks_detalle_pagos_reterenta` | 41 | 14 |
| `customrecord_ks_dias_festivos` | 167 | 13 |
| `customrecord_ks_ei_country_configuration` | 1 | 11 |
| `customrecord_ks_ei_template_config` | 3 | 13 |
| `customrecord_ks_entidad_financiera` | 577 | 11 |
| `customrecord_ks_exogeno_1010` | 0 | 0 |
| `customrecord_ks_exogenos` | muy grande (filtrar) | 27 |
| `customrecord_ks_gn_ciudadesmunicipios` | 2.125 | 13 |
| `customrecord_ks_gn_clasetercero` | 0 | 0 |
| `customrecord_ks_gn_estadosdepartamentos` | 209 | 13 |
| `customrecord_ks_gn_nm_incapacidades` | 695 | 19 |
| `customrecord_ks_gn_nm_prestamos` | 16.027 | 25 |
| `customrecord_ks_gn_paises` | 255 | 13 |
| `customrecord_ks_gn_sucursalesagencias` | 0 | 0 |
| `customrecord_ks_gn_tipoidentificacion` | 0 | 0 |
| `customrecord_ks_ident_type_bbog` | 6 | 9 |
| `customrecord_ks_ident_type_davi` | 7 | 9 |
| `customrecord_ks_ind_correo_bbog` | 2 | 9 |
| `customrecord_ks_informacion_certificado` | 38 | 12 |
| `customrecord_ks_interfases_nomina` | 8 | 10 |
| `customrecord_ks_iva_expenserepor` | 0 | 0 |
| `customrecord_ks_languaje_for_atw` | 7 | 11 |
| `customrecord_ks_log_fe` | ≥ 25.000 | 16 |
| `customrecord_ks_medios_pago_fe` | 77 | 9 |
| `customrecord_ks_medios_pago_fe_2` | 0 | 0 |
| `customrecord_ks_mov_type_bbog` | 3 | 9 |
| `customrecord_ks_nm_alias_documentos` | 0 | 0 |
| `customrecord_ks_nm_calendariosnomina` | 88 | 17 |
| `customrecord_ks_nm_childs` | 2 | 12 |
| `customrecord_ks_nm_clasescontrato` | 10 | 20 |
| `customrecord_ks_nm_clasessalario` | 8 | 15 |
| `customrecord_ks_nm_conceptos_diam` | 23 | 11 |
| `customrecord_ks_nm_conceptosnomina` | 372 | 21 |
| `customrecord_ks_nm_configuracion_columna` | 20 | 11 |
| `customrecord_ks_nm_configuracion_reliqui` | 0 | 0 |
| `customrecord_ks_nm_configuracion_vacacio` | 3 | 12 |
| `customrecord_ks_nm_control_empleados_liq` | 1.428 | 13 |
| `customrecord_ks_nm_criterios_formulas` | 141 | 16 |
| `customrecord_ks_nm_deduccionesretefuente` | 10 | 13 |
| `customrecord_ks_nm_empcuentasbancarias` | 1 | 11 |
| `customrecord_ks_nm_empdeducretencion` | 54 | 12 |
| `customrecord_ks_nm_empproteccionsocial` | 4.264 | 10 |
| `customrecord_ks_nm_empresas_vs_nominas` | 3 | 41 |
| `customrecord_ks_nm_escalassalariales` | 5 | 14 |
| `customrecord_ks_nm_estadosempleado` | 8 | 10 |
| `customrecord_ks_nm_etapas_aprendizaje` | 4 | 13 |
| `customrecord_ks_nm_forma_de_presentacion` | 2 | 10 |
| `customrecord_ks_nm_formaspagos` | 4 | 10 |
| `customrecord_ks_nm_formulas` | 78 | 12 |
| `customrecord_ks_nm_formulasliquidadoras` | 0 | 0 |
| `customrecord_ks_nm_historic_rete_2` | 1 | 13 |
| `customrecord_ks_nm_historico_liquidacion` | 0 | 0 |
| `customrecord_ks_nm_horas_empleado` | 987 | 17 |
| `customrecord_ks_nm_horas_vs_novedades` | 0 | 0 |
| `customrecord_ks_nm_informacion_bancaria` | 1 | 13 |
| `customrecord_ks_nm_jornadas` | 4 | 11 |
| `customrecord_ks_nm_libraries` | 12 | 34 |
| `customrecord_ks_nm_libro_vacaciones` | 0 | 0 |
| `customrecord_ks_nm_lista_turnos` | 1 | 11 |
| `customrecord_ks_nm_listaclasesriesgoatep` | 5 | 11 |
| `customrecord_ks_nm_listasubtipocotizante` | 5 | 11 |
| `customrecord_ks_nm_maestrovacaciones` | 1.883 | 32 |
| `customrecord_ks_nm_modulos_plantillas` | 3 | 11 |
| `customrecord_ks_nm_nom_vs_cuentas_concep` | 362 | 13 |
| `customrecord_ks_nm_nominas` | 11 | 18 |
| `customrecord_ks_nm_nominas_vs_conceptos` | 220 | 26 |
| `customrecord_ks_nm_nominas_vs_cuetnas` | 0 | 0 |
| `customrecord_ks_nm_noticias_portal` | 3 | 12 |
| `customrecord_ks_nm_novedadesnomina` | ≥ 25.000 | 25 |
| `customrecord_ks_nm_periodos_vacaciones` | 8.735 | 17 |
| `customrecord_ks_nm_plantilla_nomina` | 0 | 0 |
| `customrecord_ks_nm_plantillas_impresion` | 10 | 15 |
| `customrecord_ks_nm_porcentajesatep` | 0 | 0 |
| `customrecord_ks_nm_porlests` | 1 | 10 |
| `customrecord_ks_nm_proceso_liquidacion` | 5 | 10 |
| `customrecord_ks_nm_registroycontrol` | 0 | 0 |
| `customrecord_ks_nm_retencion_valores` | 5.838 | 28 |
| `customrecord_ks_nm_retiros_parciales` | 0 | 0 |
| `customrecord_ks_nm_solicitud_documentos` | 5 | 13 |
| `customrecord_ks_nm_tablaretencionfuente` | 24 | 14 |
| `customrecord_ks_nm_template` | 2 | 10 |
| `customrecord_ks_nm_tipo_de_aportante` | 3 | 10 |
| `customrecord_ks_nm_tipo_de_planilla` | 8 | 10 |
| `customrecord_ks_nm_tipocotizante` | 5 | 10 |
| `customrecord_ks_nm_tipodominioespecialem` | 0 | 0 |
| `customrecord_ks_nm_tipoincapacidlicencia` | 17 | 16 |
| `customrecord_ks_nm_tipoprestamos` | 0 | 0 |
| `customrecord_ks_nm_topicos_generales` | 25 | 13 |
| `customrecord_ks_nm_topicosanuales` | 8 | 31 |
| `customrecord_ks_nm_valor_ibc` | 8.245 | 15 |
| `customrecord_ks_nm_variable_documentos` | 0 | 0 |
| `customrecord_ks_nm_variables` | 74 | 11 |
| `customrecord_ks_pe_sunat_tabla10` | 61 | 11 |
| `customrecord_ks_pv_sucursalesproveedores` | 0 | 0 |
| `customrecord_ks_regimen_fiscal_ats` | 3 | 10 |
| `customrecord_ks_reporte_z` | 0 | 0 |
| `customrecord_ks_service_cod_davi` | 6 | 9 |
| `customrecord_ks_siigo_discount_ite_setup` | 2 | 10 |
| `customrecord_ks_siigo_reclassificarion_g` | 23 | 11 |
| `customrecord_ks_sp_pages` | 6 | 14 |
| `customrecord_ks_state_invoicing` | 8 | 9 |
| `customrecord_ks_subservice_cod_davi` | 2 | 9 |
| `customrecord_ks_summary_sales104` | 10 | 18 |
| `customrecord_ks_tipo_comp_autorized_ats` | 37 | 13 |
| `customrecord_ks_tipo_contribuyente` | 66 | 11 |
| `customrecord_ks_tipo_id_ats` | 2 | 11 |
| `customrecord_ks_tipo_imp_ingrexterior` | 3 | 10 |
| `customrecord_ks_tipo_impuesto` | 3 | 10 |
| `customrecord_ks_tipo_porcentaje` | 5 | 12 |
| `customrecord_ks_tipo_transaccion_bcolo` | 9 | 9 |
| `customrecord_ks_tipodedocumento_ecu` | 5 | 16 |
| `customrecord_ks_tipodedocumento_id` | 73 | 11 |
| `customrecord_ks_transacti_printed_layout` | 9 | 15 |
| `customrecord_ks_vc_tipo_dias_festivos` | 8 | 10 |
| `customrecord_ksco_config_iva_reclass` | 0 | 0 |
| `customrecord_kyryba_logs` | 303 | 26 |
| `customrecord_l598_agentes_retencion` | 4 | 12 |
| `customrecord_l598_bancos` | 0 | 0 |
| `customrecord_l598_beneficios_config` | 2 | 15 |
| `customrecord_l598_beneficios_fiscales` | 2 | 15 |
| `customrecord_l598_cajas` | 1 | 10 |
| `customrecord_l598_cajeros` | 0 | 0 |
| `customrecord_l598_categoria_sucursal` | 0 | 0 |
| `customrecord_l598_clasifi_cuenta` | 4 | 13 |
| `customrecord_l598_clausulas_vta_exp` | 15 | 10 |
| `customrecord_l598_conf_factura_elec` | 1 | 47 |
| `customrecord_l598_conf_proc_ret` | 1 | 14 |
| `customrecord_l598_config_datos_cta_ajena` | 1 | 12 |
| `customrecord_l598_config_gral_integ_bcu` | 1 | 13 |
| `customrecord_l598_config_imp_reem` | 1 | 14 |
| `customrecord_l598_datos_impositivos_emp` | 1 | 20 |
| `customrecord_l598_detalle_cred_fisc_resg` | ≥ 25.000 | 13 |
| `customrecord_l598_est_proc_gen_arch_pag` | 0 | 0 |
| `customrecord_l598_fact_elec_dlog` | ≥ 25.000 | 14 |
| `customrecord_l598_fact_elec_log` | ≥ 25.000 | 14 |
| `customrecord_l598_fe_est_log` | 3 | 10 |
| `customrecord_l598_forma_pago` | 3 | 10 |
| `customrecord_l598_gen_arch_pagos_log` | 0 | 0 |
| `customrecord_l598_gen_txt_loc_archivos` | 1 | 10 |
| `customrecord_l598_gen_txt_loc_config` | 1 | 12 |
| `customrecord_l598_gen_txt_loc_estados` | 2 | 9 |
| `customrecord_l598_gen_txt_loc_log` | 141 | 17 |
| `customrecord_l598_ind_agent_resp` | 3 | 10 |
| `customrecord_l598_ind_desc_global` | 10 | 11 |
| `customrecord_l598_ind_fact_det` | 12 | 23 |
| `customrecord_l598_ind_montos_brutos` | 3 | 11 |
| `customrecord_l598_info_referencia` | ≥ 25.000 | 11 |
| `customrecord_l598_modalidades_ventas` | 7 | 10 |
| `customrecord_l598_moneda_bcu` | 3 | 16 |
| `customrecord_l598_msg_log` | 35 | 9 |
| `customrecord_l598_paises` | 255 | 12 |
| `customrecord_l598_param_ret` | 16 | 18 |
| `customrecord_l598_param_ret_det` | 13 | 14 |
| `customrecord_l598_pro_arc_pag_conf` | 0 | 0 |
| `customrecord_l598_ret_detalle` | 413 | 27 |
| `customrecord_l598_rubro_iva` | 9 | 14 |
| `customrecord_l598_serie_comprobante` | 1 | 10 |
| `customrecord_l598_suc_banco` | 0 | 0 |
| `customrecord_l598_sucursales` | 2 | 17 |
| `customrecord_l598_tipo_integracion` | 3 | 10 |
| `customrecord_l598_tipo_trans_loc` | 13 | 11 |
| `customrecord_l598_tipo_trans_ns` | 13 | 10 |
| `customrecord_l598_tipo_transaccion_fe` | 24 | 13 |
| `customrecord_l598_tipos_cod_items` | 5 | 10 |
| `customrecord_l598_tipos_comprobantes` | 46 | 16 |
| `customrecord_l598_tipos_desc_rec` | 2 | 10 |
| `customrecord_l598_tipos_documentos` | 5 | 11 |
| `customrecord_l598_tipos_movimientos` | 2 | 10 |
| `customrecord_l598_tipos_negocios` | 4 | 10 |
| `customrecord_l598_tipos_traslados` | 3 | 10 |
| `customrecord_l598_vias_transportes` | 6 | 10 |
| `customrecord_log_aju_rec_ingr` | 17 | 11 |
| `customrecord_logs_audit_davi` | 71 | 14 |
| `customrecord_logsapidav` | 0 | 0 |
| `customrecord_lsa` | 8.910 | 11 |
| `customrecord_lsp_component_info` | 22 | 26 |
| `customrecord_lsp_country_info` | 0 | 0 |
| `customrecord_lsp_customaction_info` | 0 | 0 |
| `customrecord_mapper_category` | 13 | 13 |
| `customrecord_mapper_filter` | 5 | 14 |
| `customrecord_mapper_keyvalue` | 0 | 0 |
| `customrecord_mapper_values` | 3.236 | 12 |
| `customrecord_mcp_if_operators_subl` | 0 | 0 |
| `customrecord_mcp_if_routes_subl` | 0 | 0 |
| `customrecord_mcp_mexico_fleet_code` | 0 | 0 |
| `customrecord_mm_config_reports` | 9 | 15 |
| `customrecord_mmlogs_reports` | 42 | 17 |
| `customrecord_mode_of_transport` | 37 | 11 |
| `customrecord_moss_provisioning_status` | 0 | 0 |
| `customrecord_motivos_devolucion_nc_col` | 3 | 11 |
| `customrecord_mx_mapper_category` | 8 | 14 |
| `customrecord_mx_mapper_filter` | 6 | 14 |
| `customrecord_mx_mapper_keyvalue` | 826 | 13 |
| `customrecord_mx_pdf_language` | 3 | 10 |
| `customrecord_mx_related_cfdi_subl` | ≥ 25.000 | 14 |
| `customrecord_mx_sat_cfdi_usage` | 25 | 12 |
| `customrecord_mx_sat_export_type` | 4 | 12 |
| `customrecord_mx_sat_industry_type` | 23 | 11 |
| `customrecord_mx_sat_item_code_mirror` | 82 | 11 |
| `customrecord_mx_sat_payment_string_type` | 1 | 11 |
| `customrecord_mx_sat_payment_term` | 2 | 11 |
| `customrecord_mx_sat_rel_type` | 9 | 11 |
| `customrecord_mx_sat_tax_object` | 5 | 12 |
| `customrecord_mx_scheduled_task_summary` | 3 | 11 |
| `customrecord_nav_category` | 0 | 0 |
| `customrecord_nav_shortcut` | 4 | 9 |
| `customrecord_nav_shortcutgroup` | 0 | 0 |
| `customrecord_nc_motivos` | 37 | 10 |
| `customrecord_no_2digit_mapping` | 0 | 0 |
| `customrecord_no_4digit_mapping` | 0 | 0 |
| `customrecord_no_in_mapper_1167_keyvalue` | 0 | 0 |
| `customrecord_no_in_mapper_1175_keyvalue` | 0 | 0 |
| `customrecord_no_in_mapper_1323_keyvalue` | 0 | 0 |
| `customrecord_no_income_mapper_keyvalue` | 0 | 0 |
| `customrecord_no_standard_tax_codes` | 30 | 12 |
| `customrecord_no_std_tax_keyvalue` | 0 | 0 |
| `customrecord_no_sub_tax_codes` | 0 | 0 |
| `customrecord_norway_mapper_keyvalue` | 0 | 0 |
| `customrecord_notc` | 44 | 11 |
| `customrecord_notc_default` | 0 | 0 |
| `customrecord_opt_debaut_uy` | 11 | 41 |
| `customrecord_opt_proceso_conciliacion` | 12 | 15 |
| `customrecord_pagos_api_col` | 11 | 21 |
| `customrecord_param_por_subsidiaria1` | 4 | 31 |
| `customrecord_ph4014_wtax_jrnl_type` | 7 | 8 |
| `customrecord_ph4014_wtax_type_kind` | 0 | 0 |
| `customrecord_proc_retenciones_sri_ecu` | ≥ 25.000 | 23 |
| `customrecord_psg_ei_audit_trail` | muy grande (filtrar) | 14 |
| `customrecord_psg_ei_conversion_batch` | 0 | 0 |
| `customrecord_psg_ei_email_custom` | 1 | 11 |
| `customrecord_psg_ei_email_recipient` | ≥ 25.000 | 11 |
| `customrecord_psg_ei_email_recipient_vend` | 2 | 11 |
| `customrecord_psg_ei_email_sender_cust` | 0 | 0 |
| `customrecord_psg_ei_email_sender_vend` | 0 | 0 |
| `customrecord_psg_ei_inbound_edoc` | 0 | 0 |
| `customrecord_psg_ei_peppol_tax_category` | 12 | 10 |
| `customrecord_psg_ei_response_status` | 20 | 11 |
| `customrecord_psg_ei_sending_batch` | 0 | 0 |
| `customrecord_psg_ei_standards` | 6 | 11 |
| `customrecord_psg_ei_template_validator` | 365 | 12 |
| `customrecord_psg_mx_bank_info` | 924 | 12 |
| `customrecord_psg_sal_ph_cas_app` | 3 | 9 |
| `customrecord_psg_sal_ph_seller_type` | 2 | 9 |
| `customrecord_pt_mr_task_summary` | 1 | 11 |
| `customrecord_pt_taxonomy_reference` | 4 | 10 |
| `customrecord_re_ds_oc_aplicacion` | 19 | 20 |
| `customrecord_regime_code` | 7 | 12 |
| `customrecord_report_preferences_mapping` | 0 | 0 |
| `customrecord_resp_bco_deb_aut_uy` | ≥ 25.000 | 21 |
| `customrecord_rp_ks_forma_pago` | 8 | 10 |
| `customrecord_sas_approval_history` | ≥ 25.000 | 18 |
| `customrecord_sas_approvalmatrix` | 75 | 14 |
| `customrecord_sas_approvalrule` | 37 | 27 |
| `customrecord_sas_department_approver` | 40 | 13 |
| `customrecord_sas_draft_approval` | 11 | 11 |
| `customrecord_sas_email_templates` | 6 | 12 |
| `customrecord_sas_mapping_setup` | 7 | 26 |
| `customrecord_sas_mirror_approval` | 19.589 | 23 |
| `customrecord_sas_ss_exp_apprule` | 92 | 12 |
| `customrecord_sas_ss_exp_mapping` | 23 | 14 |
| `customrecord_schedule_scripts` | 6 | 17 |
| `customrecord_sii_list_val` | 65 | 11 |
| `customrecord_sii_reg_error_codes` | 251 | 12 |
| `customrecord_statistical_procedure` | 20 | 12 |
| `customrecord_statutory_coa` | 0 | 0 |
| `customrecord_street_type_values` | 19 | 11 |
| `customrecord_supplementary_unit` | 31 | 10 |
| `customrecord_taf_configuration` | 3 | 12 |
| `customrecord_taf_job` | 0 | 0 |
| `customrecord_taf_ph_report_prefs` | 0 | 0 |
| `customrecord_taf_rep_config` | 0 | 0 |
| `customrecord_taf_report_task` | 0 | 0 |
| `customrecord_taf_report_threshold` | 0 | 0 |
| `customrecord_taf_search_task` | 0 | 0 |
| `customrecord_taf_setupconfig` | 3 | 11 |
| `customrecord_taf_setupconfig_value` | 0 | 0 |
| `customrecord_tax_cache` | 0 | 0 |
| `customrecord_tax_cache_detail` | 0 | 0 |
| `customrecord_tax_field` | 1.375 | 15 |
| `customrecord_tax_field_notation` | 1.180 | 18 |
| `customrecord_tax_form` | 50 | 10 |
| `customrecord_tax_report_map` | 288 | 18 |
| `customrecord_tax_report_map_details` | 238 | 19 |
| `customrecord_tax_report_map_option` | 29 | 12 |
| `customrecord_tax_return_setup_item` | 0 | 0 |
| `customrecord_tax_template` | 667 | 16 |
| `customrecord_tcrp_codigo_sustento` | 16 | 10 |
| `customrecord_template_attachment` | 489 | 11 |
| `customrecord_template_content` | 10 | 10 |
| `customrecord_token_dav` | 14 | 15 |
| `customrecord_transaction_nature` | 2 | 11 |
| `customrecord_trantypelist` | 9 | 10 |
| `customrecord_vatonline_detail` | 0 | 0 |
| `customrecord_vatonline_submittedperiod` | 0 | 0 |
| `customrecord_wht_report_sys_notes` | 0 | 0 |
| `customrecord_wtax_cache` | 0 | 0 |
| `customrecord_wtax_job` | 0 | 0 |
| `customrecordcustomrecord_customsearch` | 1 | 10 |
| `customrecorddocumentos_davivienda` | 19 | 11 |
| `customrecordtipos_de_cuenta_davivienda` | 6 | 10 |

## Anexo C · Listas personalizadas

201 listas. Cada una se consulta con `SELECT id, name FROM <lista>`.

`customlist`, `customlist102`, `customlist1658`, `customlist1659`, `customlist1990`, `customlist1991`, `customlist2022`, `customlist2158`, `customlist2516`, `customlist2517`, `customlist2518`, `customlist2519`, `customlist2520`, `customlist2521`, `customlist2522`, `customlist2733`, `customlist_11664_payment_mode`, `customlist_12194_processing_result`, `customlist_15906_ep_log_type`, `customlist_2663_acct_type`, `customlist_2663_approval_level`, `customlist_2663_approval_type`, `customlist_2663_bank_acct_type`, `customlist_2663_bank_fee_code`, `customlist_2663_batch_priority`, `customlist_2663_batch_status`, `customlist_2663_billing_type`, `customlist_2663_day_of_week`, `customlist_2663_direct_debit_type`, `customlist_2663_entity_bank_type`, `customlist_2663_ep_process`, `customlist_2663_output_file_encoding`, `customlist_2663_payment_type`, `customlist_2663_process_status`, `customlist_2663_recurrence`, `customlist_2663_reference_amended_type`, `customlist_2663_schedule_event_type`, `customlist_2663_schedule_type`, `customlist_2663_week_of_month`, `customlist_8299_cat_type`, `customlist_8299_license_cache_status`, `customlist_ach_ep_migration_recordtype`, `customlist_api_davivienda`, `customlist_atlas_prowb_trans_list`, `customlist_av_valid_states_list`, `customlist_bancos_comision`, `customlist_banks_loc_ecu`, `customlist_bf_api_types`, `customlist_campos_libres_lista`, `customlist_cancel_info`, `customlist_code_of_supply`, `customlist_credit_fact_descipt_correct`, `customlist_ct_bancarias_comisiones`, `customlist_deferred_tax`, `customlist_delivery_terms`, `customlist_dt_tile_alertops`, `customlist_dt_tile_comparetype`, `customlist_dt_tile_summarytype`, `customlist_dt_tile_transflds`, `customlist_dt_tile_type`, `customlist_dt_translatable_flds`, `customlist_dt_wrapping`, `customlist_entry_or_exit_of_goods`, `customlist_ep_payment_priority`, `customlist_erp_mandato_reg`, `customlist_estadocfdi`, `customlist_estados_prog_pago_davi`, `customlist_estados_siigo_pay`, `customlist_etapas_bills`, `customlist_familia_reporte`, `customlist_forma_entrega`, `customlist_ks_agrupacion_factura`, `customlist_ks_ats_tipo_de_iva`, `customlist_ks_atw_order_phrase`, `customlist_ks_atw_type`, `customlist_ks_atw_type_sentence`, `customlist_ks_banco_siigo`, `customlist_ks_co_journal_type_list`, `customlist_ks_ei_documentformat`, `customlist_ks_ei_integration_list`, `customlist_ks_ei_method_list`, `customlist_ks_fe_puntoemision`, `customlist_ks_forma_pago_fe`, `customlist_ks_gn_listagenero`, `customlist_ks_gn_listatipoctabancaria`, `customlist_ks_gn_listatipoproveedor`, `customlist_ks_lista_notas_excepcion_fe`, `customlist_ks_lista_tipo_doc_fe`, `customlist_ks_listaregimentr`, `customlist_ks_listgrupdocoddiagnostico`, `customlist_ks_nm_condicionales`, `customlist_ks_nm_estado_config`, `customlist_ks_nm_estados_calendario`, `customlist_ks_nm_gn_tipoprestamo`, `customlist_ks_nm_lis_tipodiscapacidad`, `customlist_ks_nm_liscategorialibretami`, `customlist_ks_nm_lisdiasservicio`, `customlist_ks_nm_lisfactorrh`, `customlist_ks_nm_lisnivelestudios`, `customlist_ks_nm_list_jornada`, `customlist_ks_nm_lista_aplicapara`, `customlist_ks_nm_lista_cod_diagnostico`, `customlist_ks_nm_lista_formato`, `customlist_ks_nm_listaclaseconcepto`, `customlist_ks_nm_listaestadocivil`, `customlist_ks_nm_listareportaconcepto`, `customlist_ks_nm_listatipoley`, `customlist_ks_nm_listatipoprocesonomin`, `customlist_ks_nm_listatiporetencion`, `customlist_ks_nm_listatipovinculacion`, `customlist_ks_nm_listclasetiempo`, `customlist_ks_nm_listipoadministradora`, `customlist_ks_nm_listipocontrato`, `customlist_ks_nm_niveles_abiertos`, `customlist_ks_nm_niveles_cerrados`, `customlist_ks_nm_pais`, `customlist_ks_nm_promedios`, `customlist_ks_nm_retencion_procedimien`, `customlist_ks_nm_tipo_concepto_diam`, `customlist_ks_nm_tipo_ibc`, `customlist_ks_nm_tipo_modulo`, `customlist_ks_nm_tipoconcepto_lista`, `customlist_ks_nm_y_o`, `customlist_ks_oppago`, `customlist_ks_porcentaje_prologa`, `customlist_ks_regimenecuador`, `customlist_ks_se_estatus_cliente`, `customlist_ks_se_estatus_cliente_2`, `customlist_ks_siigo_tipo_je`, `customlist_ks_sp_menu`, `customlist_ks_sp_page_type`, `customlist_ks_tax_type_co`, `customlist_ks_tipo_cuenta`, `customlist_ks_tipo_de_liquidacion`, `customlist_ks_tipo_documento_manual`, `customlist_ks_tipocontribuyente`, `customlist_ks_tipocuenta_bi`, `customlist_ks_tipodocumento_bi`, `customlist_ks_trantype`, `customlist_kyr_log_validation`, `customlist_kyryba_log_status`, `customlist_list_estados_api_dav`, `customlist_lista_motivos`, `customlist_lsp_listof_features`, `customlist_lsp_status`, `customlist_mcp_fleet_type`, `customlist_metodo_pago_r`, `customlist_modalidades`, `customlist_mx_l10n_app`, `customlist_mx_l10n_status`, `customlist_mx_operation_type`, `customlist_mx_sat_item_type`, `customlist_nature_of_transaction_code`, `customlist_nm_corte_calendario`, `customlist_operation_type`, `customlist_payment_type`, `customlist_psg_ei_audit_trail_events`, `customlist_psg_ei_direction_type`, `customlist_psg_ei_edoc_automation`, `customlist_psg_ei_file_content_type`, `customlist_psg_ei_inbound_source`, `customlist_psg_ei_po_processing_types`, `customlist_psg_ei_sending_batch_status`, `customlist_psg_ei_sent_status`, `customlist_psg_ei_status`, `customlist_psg_ei_unmatched_items`, `customlist_psg_ei_validation`, `customlist_regime_code_of_supply`, `customlist_saldo_a_reportar`, `customlist_sas_approval_action`, `customlist_sas_approvalmatrix_apptype`, `customlist_sas_tol_reapproval_type`, `customlist_sas_transaction_state`, `customlist_sas_transaction_types`, `customlist_se_comprobante`, `customlist_se_comprobante_2`, `customlist_sii_list_type`, `customlist_sii_registration_status`, `customlist_siigo_estado_de_conciliacio`, `customlist_sub_tax_code_trans_type`, `customlist_taf_job_status`, `customlist_taf_task_status`, `customlist_tax_exemption_code`, `customlist_tipo_cta_deb_aut_uy`, `customlist_tipo_lstauditdav`, `customlist_tipo_venta`, `customlist_type_of_goods`, `customlist_unit_types`, `customlist_wht_je_apply_as_list`, `customlistarea_usuaria`, `customlistcodigo_iso_paises_fe`, `customlistcomision_o_cancelacion`, `customlistcustomlist_anticipo_viaticos`, `customlistcustomlist_tipo_de_viaje`, `customlistcustomlist_tipo_informe`, `customlistks_nm_lisformapagos`, `customlistks_nm_listasindicatos`, `customlistph4185_bstyle`, `customlistrecurrencia`, `customliststreet_directions`, `customlisttipodedistribuidormx`

## Anexo D · Tablas que no responden

| Tabla | Motivo |
|---|---|
| `assemblyitem` | No existe en SuiteQL (o el rol no lo ve) |
| `bankaccount` | No es tabla consultable en SuiteQL |
| `billingaccount` | No existe en SuiteQL (o el rol no lo ve) |
| `bin` | No existe en SuiteQL (o el rol no lo ve) |
| `bom` | No existe en SuiteQL (o el rol no lo ve) |
| `budget` | No es tabla consultable en SuiteQL |
| `costcategory` | No existe en SuiteQL (o el rol no lo ve) |
| `couponcode` | No existe en SuiteQL (o el rol no lo ve) |
| `customrecordtype` | No existe en SuiteQL (o el rol no lo ve) |
| `customtransaction_l598_anul_resguardo` | No existe en SuiteQL (o el rol no lo ve) |
| `customtransaction_l598_anulacion_cobranz` | No existe en SuiteQL (o el rol no lo ve) |
| `customtransaction_l598_resguardos` | No existe en SuiteQL (o el rol no lo ve) |
| `customtransaction_l598_retencion` | No existe en SuiteQL (o el rol no lo ve) |
| `downloaditem` | No existe en SuiteQL (o el rol no lo ve) |
| `employeestatus` | No existe en SuiteQL (o el rol no lo ve) |
| `expensereport` | `SELECT *` falla: listar columnas explícitas |
| `giftcertificateitem` | No existe en SuiteQL (o el rol no lo ve) |
| `glnumbering` | No es tabla consultable en SuiteQL |
| `glnumberingsequence` | No existe en SuiteQL (o el rol no lo ve) |
| `impactsubcategory` | No existe en SuiteQL (o el rol no lo ve) |
| `intercompanyjournalentry` | No existe en SuiteQL (o el rol no lo ve) |
| `inventorynumber` | No existe en SuiteQL (o el rol no lo ve) |
| `loginaudittrail` | No es tabla consultable en SuiteQL |
| `lotnumberedassemblyitem` | No existe en SuiteQL (o el rol no lo ve) |
| `lotnumberedinventoryitem` | No existe en SuiteQL (o el rol no lo ve) |
| `nextransactionlinelink` | No es tabla consultable en SuiteQL |
| `noninventoryitem` | No existe en SuiteQL (o el rol no lo ve) |
| `partner` | No existe en SuiteQL (o el rol no lo ve) |
| `paymenttokentype` | No existe en SuiteQL (o el rol no lo ve) |
| `promotioncode` | No existe en SuiteQL (o el rol no lo ve) |
| `revrecschedule` | No existe en SuiteQL (o el rol no lo ve) |
| `revrectemplate` | No existe en SuiteQL (o el rol no lo ve) |
| `role` | No existe en SuiteQL (o el rol no lo ve) |
| `script` | No existe en SuiteQL (o el rol no lo ve) |
| `scriptdeployment` | No existe en SuiteQL (o el rol no lo ve) |
| `serializedassemblyitem` | No existe en SuiteQL (o el rol no lo ve) |
| `serializedinventoryitem` | No existe en SuiteQL (o el rol no lo ve) |
| `serviceitem` | No existe en SuiteQL (o el rol no lo ve) |
| `subscription` | No existe en SuiteQL (o el rol no lo ve) |
| `subscriptionline` | No existe en SuiteQL (o el rol no lo ve) |
| `subscriptionterm` | No existe en SuiteQL (o el rol no lo ve) |
| `systemnote` | Tiempo agotado incluso con filtro |
| `taxadjustmentjournalentry` | No existe en SuiteQL (o el rol no lo ve) |
| `taxitem` | No es tabla consultable en SuiteQL |
| `timesheet` | No existe en SuiteQL (o el rol no lo ve) |
| `transactionlinkedtransactions` | No es tabla consultable en SuiteQL |
| `unitstype` | No existe en SuiteQL (o el rol no lo ve) |

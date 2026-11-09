-- Plantilla "Bancos · Contadora": replica la búsqueda guardada de contabilidad
-- (movimiento por cuenta de bancos de SIIGO S.A.S).
--
-- Filtros de la búsqueda en NetSuite → filtros del export:
--   Contabilización es verdadero      → siempre (tal.posting = 'T')
--   Tipo de cuenta es Banco           → Tipo Cuenta = Bank (incluye diarios)
--   Subsidiaria es SIIGO S.A.S        → tl.subsidiary = 3
--   Centros de Costo no es 201 Colombia → excluir departamento 197 (deja los vacíos)
--   Moneda / Compañía Gestión "todos" y NIT Beneficiario vacío no restringen.
--
-- Validado contra el reporte de septiembre 2026: 52.949 de 53.096 filas, sin
-- sobrantes. Las 147 restantes son Reembolsos al cliente y Transferencias, que
-- el rol de integración de NetSuite aún no puede ver (permiso pendiente).

insert into export_bancos.plantillas (nombre, campos, filtros, created_by, updated_by)
select
  'Bancos · Contadora',
  array(
    select c.id
    from unnest(array[
      't.id:valor', 't.type:texto', 't.tranid:valor', 't.trandate:valor',
      'ter.documento:valor', 'ter.nombre:valor', 'tl.entity:texto',
      'a.acctnumber:valor', 'a.accountsearchdisplaynamecopy:valor',
      'tl.debitforeignamount:valor', 'tl.creditforeignamount:valor',
      'tal.debit:valor', 'tal.credit:valor',
      'tl.memo:valor', 't.memo:valor', 'tl.department:texto'
    ]) with ordinality as k(clave, pos)
    join export_bancos.campos c on c.tabla || '.' || c.campo || ':' || c.modo = k.clave
    order by k.pos
  ),
  jsonb_build_array(
    jsonb_build_object(
      'campoId', (select id from export_bancos.campos where tabla = 'a' and campo = 'accttype' and modo = 'valor'),
      'tipo', 'lista', 'modo', 'incluir',
      'valores', jsonb_build_array(jsonb_build_object('v', 'Bank', 'l', 'Banco'))
    ),
    jsonb_build_object(
      'campoId', (select id from export_bancos.campos where tabla = 'tl' and campo = 'subsidiary' and modo = 'texto'),
      'tipo', 'lista', 'modo', 'incluir',
      'valores', jsonb_build_array(jsonb_build_object('v', '3', 'l', 'SIIGO S.A.S'))
    ),
    jsonb_build_object(
      'campoId', (select id from export_bancos.campos where tabla = 'tl' and campo = 'department' and modo = 'texto'),
      'tipo', 'lista', 'modo', 'excluir',
      'valores', jsonb_build_array(jsonb_build_object('v', '197', 'l', '201 Colombia'))
    )
  ),
  null,
  null
where not exists (
  select 1 from export_bancos.plantillas where lower(btrim(nombre)) = lower('Bancos · Contadora')
);

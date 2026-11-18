-- Ajuste de listas desplegables de gestión de anticipos (petición de la contadora).
--   falta:         quita permisos_de_soportes y autorizacion_soportes; agrega no_ha_viajado.
--   observacion_1: quita escrito_3_veces y legalizado; agrega correo_al_colaborador.
-- Postgres no permite quitar valores de un enum: se recrean los tipos.

begin;

-- El trigger depende de las columnas falta/observacion_1: se quita y se recrea al final.
-- (Además evita que el UPDATE de reubicación cambie updated_at.)
drop trigger anticipos_registros_set_updated_at on anticipos.registros;

-- Reubicar filas con valores que desaparecen.
-- "legalizado" en observación 1 pasa a falta = legalizado (así no pierden el estado resuelto).
update anticipos.registros set falta = 'legalizado'
 where observacion_1 = 'legalizado' and falta <> 'legalizado';
update anticipos.registros set falta = 'soportes'
 where falta in ('permisos_de_soportes', 'autorizacion_soportes');
update anticipos.registros set observacion_1 = 'no_se_ha_contactado'
 where observacion_1 = 'legalizado';
update anticipos.registros set observacion_1 = 'correo_al_lider'
 where observacion_1 = 'escrito_3_veces';

alter type anticipos.falta rename to falta_old;
create type anticipos.falta as enum (
  'no_ha_viajado',
  'soportes',
  'revisar_soportes',
  'autorizacion_descuento_nomina',
  'revisar_con_harold',
  'registrar',
  'revisar_descuento_nomina',
  'devolucion',
  'legalizado'
);
alter table anticipos.registros
  alter column falta type anticipos.falta using falta::text::anticipos.falta;
drop type anticipos.falta_old;

alter type anticipos.observacion_1 rename to observacion_1_old;
create type anticipos.observacion_1 as enum (
  'no_se_ha_contactado',
  'escrito_1_vez',
  'escrito_2_veces',
  'correo_al_colaborador',
  'correo_al_lider'
);
alter table anticipos.registros
  alter column observacion_1 type anticipos.observacion_1 using observacion_1::text::anticipos.observacion_1;
drop type anticipos.observacion_1_old;

create trigger anticipos_registros_set_updated_at
  before update of nombre, requerimiento, falta, observacion_1, observacion_2, fecha_rq, fecha_gestion, updated_by
  on anticipos.registros
  for each row execute function private.set_updated_at();

commit;

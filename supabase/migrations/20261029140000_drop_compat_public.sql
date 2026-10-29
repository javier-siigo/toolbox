-- Elimina la capa de compatibilidad de `20261029120000_schemas_por_proceso.sql`.
-- Aplicar SOLO cuando el portal desplegado ya use `.schema(...)` (sin esto, la versión
-- vieja deja de encontrar las tablas).

drop view if exists public.user_roles;
drop view if exists public.user_activity;
drop view if exists public.conciliacion_bancos;
drop view if exists public.anticipos_registros;
drop view if exists public.colaboradores_retirados;
drop view if exists public.colaboradores_retirados_imports;
drop view if exists public.comisiones_conceptos;
drop view if exists public.comisiones_periodo_valores;
drop view if exists public.comisiones_bases;
drop view if exists public.comisiones_reconocimientos;
drop view if exists public.comisiones_gasto_registrado;
drop view if exists public.comisiones_cierres;
drop view if exists public.netsuite_campos;
drop view if exists public.netsuite_campo_valores;
drop view if exists public.export_bancos_plantillas;

drop function if exists public.touch_last_seen();
drop function if exists public.comisiones_guardar_cierre(text, jsonb, jsonb);
drop function if exists public.match_colaborador_retirado(text);
drop function if exists public.match_colaborador_retirado_batch(text[]);

-- `public` queda vacío a propósito: las tablas nuevas van en el schema de su proceso.
revoke create on schema public from anon, authenticated;

notify pgrst, 'reload schema';

-- Reorganiza la BD en un schema por proceso para que `public` no crezca sin control.
--
--   core            Transversal al portal: roles y actividad de usuarios.
--   private         Helpers internos (RLS, triggers, normalización). NO se expone en la Data API.
--   conciliaciones  Catálogo de bancos/webhooks.
--   anticipos       Gestión de anticipos + excolaboradores (retirados) con los que se cruza.
--   comisiones      Cálculo de comisiones diferidas.
--   export_bancos   Catálogo de campos NetSuite y plantillas del export de movimientos.
--
-- Las tablas se mueven con ALTER ... SET SCHEMA: conservan datos, índices, constraints,
-- triggers y políticas RLS. Las funciones se mueven igual (mismo OID, así que las políticas
-- y columnas generadas que las usan siguen apuntando bien) y luego se reescribe su cuerpo,
-- porque el texto sí hace referencia a los nombres viejos.
--
-- También:
--   - Elimina `conciliacion_workbook_state` y las políticas del bucket `conciliaciones-workbooks`
--     (funcionalidad abandonada; el bucket se vacía y borra por Storage API).
--   - `anon` deja de tener privilegios en las tablas: el portal siempre opera con sesión.
--
-- Compatibilidad: al final se crean vistas y wrappers en `public` con los nombres viejos para
-- que la versión desplegada del portal siga funcionando hasta que salga la nueva. Se eliminan
-- en la migración siguiente (`..._drop_compat_public.sql`).

-- ─── Schemas ────────────────────────────────────────────────────────────────

create schema if not exists core;
create schema if not exists private;
create schema if not exists conciliaciones;
create schema if not exists anticipos;
create schema if not exists comisiones;
create schema if not exists export_bancos;

-- ─── Limpieza: workbooks de conciliación (sin uso) ──────────────────────────

drop table if exists public.conciliacion_workbook_state;

drop policy if exists "workbook bucket select" on storage.objects;
drop policy if exists "workbook bucket insert" on storage.objects;
drop policy if exists "workbook bucket update" on storage.objects;
drop policy if exists "workbook bucket delete" on storage.objects;

-- ─── private ────────────────────────────────────────────────────────────────

alter function public.set_updated_at() set schema private;
alter function public.current_user_has_role(text) set schema private;
alter function public.normalize_colaborador_name(text) set schema private;
alter function public.normalize_colaborador_name_unsorted(text) set schema private;

-- ─── core ───────────────────────────────────────────────────────────────────

alter table public.user_roles set schema core;
alter table public.user_activity set schema core;
alter function public.touch_last_seen() set schema core;

-- ─── conciliaciones ─────────────────────────────────────────────────────────

alter table public.conciliacion_bancos set schema conciliaciones;
alter table conciliaciones.conciliacion_bancos rename to bancos;

-- ─── anticipos ──────────────────────────────────────────────────────────────

alter table public.anticipos_registros set schema anticipos;
alter table anticipos.anticipos_registros rename to registros;
alter table public.colaboradores_retirados set schema anticipos;
alter table anticipos.colaboradores_retirados rename to retirados;
alter table public.colaboradores_retirados_imports set schema anticipos;
alter table anticipos.colaboradores_retirados_imports rename to retirados_imports;

alter type public.anticipos_falta_enum set schema anticipos;
alter type anticipos.anticipos_falta_enum rename to falta;
alter type public.anticipos_observacion_1_enum set schema anticipos;
alter type anticipos.anticipos_observacion_1_enum rename to observacion_1;

alter function public.match_colaborador_retirado(text) set schema anticipos;
alter function public.match_colaborador_retirado_batch(text[]) set schema anticipos;

-- ─── comisiones ─────────────────────────────────────────────────────────────

alter table public.comisiones_conceptos set schema comisiones;
alter table comisiones.comisiones_conceptos rename to conceptos;
alter table public.comisiones_periodo_valores set schema comisiones;
alter table comisiones.comisiones_periodo_valores rename to periodo_valores;
alter table public.comisiones_bases set schema comisiones;
alter table comisiones.comisiones_bases rename to bases;
alter table public.comisiones_reconocimientos set schema comisiones;
alter table comisiones.comisiones_reconocimientos rename to reconocimientos;
alter table public.comisiones_gasto_registrado set schema comisiones;
alter table comisiones.comisiones_gasto_registrado rename to gasto_registrado;
alter table public.comisiones_cierres set schema comisiones;
alter table comisiones.comisiones_cierres rename to cierres;

alter function public.comisiones_guardar_cierre(text, jsonb, jsonb) set schema comisiones;
alter function comisiones.comisiones_guardar_cierre(text, jsonb, jsonb) rename to guardar_cierre;

-- ─── export_bancos ──────────────────────────────────────────────────────────

alter table public.netsuite_campos set schema export_bancos;
alter table export_bancos.netsuite_campos rename to campos;
alter table public.netsuite_campo_valores set schema export_bancos;
alter table export_bancos.netsuite_campo_valores rename to campo_valores;
alter table public.export_bancos_plantillas set schema export_bancos;
alter table export_bancos.export_bancos_plantillas rename to plantillas;

-- ─── Cuerpos de funciones con los nombres nuevos ────────────────────────────

create or replace function private.current_user_has_role(check_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from core.user_roles
    where user_id = auth.uid()
      and check_role = any(roles)
  );
$$;

create or replace function core.touch_last_seen()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into core.user_activity (user_id, last_seen_at)
  select auth.uid(), now()
  where auth.uid() is not null
  on conflict (user_id) do update
    set last_seen_at = excluded.last_seen_at
    where core.user_activity.last_seen_at < now() - interval '5 minutes';
$$;

create or replace function anticipos.match_colaborador_retirado(p_input text)
returns table(cedula numeric, nombre text, valor numeric, observacion text, fecha_reporte date, nivel text, tokens_comunes text[], tokens_extra text[])
language sql
stable
set search_path = ''
as $$
  with input as (
    select string_to_array(
      private.normalize_colaborador_name_unsorted(p_input),
      ' '
    ) as toks
  ),
  scored as (
    select
      r.cedula,
      r.nombre,
      r.valor,
      r.observacion,
      r.fecha_reporte,
      string_to_array(
        private.normalize_colaborador_name_unsorted(r.nombre),
        ' '
      ) as r_toks,
      (select toks from input) as i_toks,
      case
        when string_to_array(
          private.normalize_colaborador_name_unsorted(r.nombre),
          ' '
        ) = (select toks from input) then 'exacto'
        when string_to_array(
          private.normalize_colaborador_name_unsorted(r.nombre),
          ' '
        ) = (
          select array_agg(t.token::text order by t.ord desc)
          from unnest((select toks from input)) with ordinality as t(token, ord)
        ) then 'exacto_inverso'
        else 'parcial'
      end as lvl
    from anticipos.retirados r
    where (select array_length(toks, 1) from input) >= 1
  )
  select
    s.cedula,
    s.nombre,
    s.valor,
    s.observacion,
    s.fecha_reporte,
    s.lvl,
    array(
      select unnest(s.i_toks)
      intersect
      select unnest(s.r_toks)
    ) as comunes,
    array(
      select unnest(s.r_toks)
      except
      select unnest(s.i_toks)
    ) as extras
  from scored s
  where s.r_toks @> s.i_toks
  order by
    case s.lvl
      when 'exacto' then 0
      when 'exacto_inverso' then 1
      else 2
    end,
    array_length(
      array(
        select unnest(s.r_toks)
        except
        select unnest(s.i_toks)
      ),
      1
    ),
    s.cedula;
$$;

create or replace function anticipos.match_colaborador_retirado_batch(p_inputs text[])
returns table(query text, cedula numeric, nombre text, valor numeric, observacion text, fecha_reporte date, nivel text, tokens_comunes text[], tokens_extra text[])
language sql
stable
set search_path = ''
as $$
  with inputs as (
    select q.input as query,
           string_to_array(
             private.normalize_colaborador_name_unsorted(q.input),
             ' '
           ) as toks
    from unnest(p_inputs) as q(input)
    where length(trim(q.input)) > 0
  ),
  scored as (
    select
      i.query,
      r.cedula,
      r.nombre,
      r.valor,
      r.observacion,
      r.fecha_reporte,
      string_to_array(
        private.normalize_colaborador_name_unsorted(r.nombre),
        ' '
      ) as r_toks,
      i.toks as i_toks,
      case
        when string_to_array(
          private.normalize_colaborador_name_unsorted(r.nombre),
          ' '
        ) = i.toks then 'exacto'
        when string_to_array(
          private.normalize_colaborador_name_unsorted(r.nombre),
          ' '
        ) = (
          select array_agg(t.token::text order by t.ord desc)
          from unnest(i.toks) with ordinality as t(token, ord)
        ) then 'exacto_inverso'
        else 'parcial'
      end as lvl
    from inputs i
    cross join anticipos.retirados r
  ),
  filtered as (
    select
      s.query,
      s.cedula,
      s.nombre,
      s.valor,
      s.observacion,
      s.fecha_reporte,
      s.lvl,
      array(
        select unnest(s.i_toks)
        intersect
        select unnest(s.r_toks)
      ) as comunes,
      array(
        select unnest(s.r_toks)
        except
        select unnest(s.i_toks)
      ) as extras,
      array_length(
        array(
          select unnest(s.r_toks)
          except
          select unnest(s.i_toks)
        ),
        1
      ) as extras_len
    from scored s
    where s.r_toks @> s.i_toks
  ),
  ranked as (
    select
      f.*,
      row_number() over (
        partition by f.query
        order by
          case f.lvl
            when 'exacto' then 0
            when 'exacto_inverso' then 1
            else 2
          end,
          f.extras_len,
          f.cedula
      ) as rn
    from filtered f
  )
  select
    r.query,
    r.cedula,
    r.nombre,
    r.valor,
    r.observacion,
    r.fecha_reporte,
    r.lvl,
    r.comunes,
    r.extras
  from ranked r
  where r.rn = 1;
$$;

create or replace function comisiones.guardar_cierre(p_periodo text, p_reconocimientos jsonb, p_cierre jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from comisiones.reconocimientos where periodo = p_periodo;

  insert into comisiones.reconocimientos
    (cohorte, periodo, prefijo, ingreso, pendiente_ingreso, fuente)
  select r.cohorte, p_periodo, r.prefijo, r.ingreso, r.pendiente_ingreso, 'informe'
  from jsonb_to_recordset(p_reconocimientos)
    as r(cohorte text, prefijo text, ingreso numeric, pendiente_ingreso numeric);

  insert into comisiones.cierres (
    periodo, archivo_nombre, archivo_tamano, gasto_mes, diferido_nuevo,
    saldo_diferido, asientos, controles
  ) values (
    p_periodo,
    p_cierre ->> 'archivoNombre',
    (p_cierre ->> 'archivoTamano')::bigint,
    (p_cierre ->> 'gastoMes')::numeric,
    (p_cierre ->> 'diferidoNuevo')::numeric,
    (p_cierre ->> 'saldoDiferido')::numeric,
    coalesce(p_cierre -> 'asientos', '[]'::jsonb),
    coalesce(p_cierre -> 'controles', '[]'::jsonb)
  )
  on conflict (periodo) do update set
    archivo_nombre = excluded.archivo_nombre,
    archivo_tamano = excluded.archivo_tamano,
    gasto_mes = excluded.gasto_mes,
    diferido_nuevo = excluded.diferido_nuevo,
    saldo_diferido = excluded.saldo_diferido,
    asientos = excluded.asientos,
    controles = excluded.controles,
    created_at = now(),
    created_by = auth.uid();
end;
$$;

-- ─── Privilegios ────────────────────────────────────────────────────────────
-- RLS sigue siendo la barrera real; esto solo quita lo que nunca debió estar
-- (anon con INSERT/DELETE/TRUNCATE) y deja el mínimo para authenticated.
-- Los default privileges hacen que las tablas nuevas de cada schema nazcan igual.

do $$
declare
  s text;
begin
  foreach s in array array['core', 'conciliaciones', 'anticipos', 'comisiones', 'export_bancos'] loop
    execute format('grant usage on schema %I to authenticated, service_role', s);

    execute format('revoke all on all tables in schema %I from anon, authenticated', s);
    execute format('grant select, insert, update, delete on all tables in schema %I to authenticated', s);
    execute format('grant all on all tables in schema %I to service_role', s);
    execute format('grant usage, select on all sequences in schema %I to authenticated, service_role', s);

    execute format('revoke execute on all functions in schema %I from public, anon', s);
    execute format('grant execute on all functions in schema %I to authenticated, service_role', s);

    execute format('alter default privileges in schema %I grant select, insert, update, delete on tables to authenticated', s);
    execute format('alter default privileges in schema %I grant all on tables to service_role', s);
    execute format('alter default privileges in schema %I grant usage, select on sequences to authenticated, service_role', s);
    execute format('alter default privileges in schema %I revoke execute on functions from public', s);
    execute format('alter default privileges in schema %I grant execute on functions to authenticated, service_role', s);
  end loop;
end $$;

-- private: no se expone en la API, pero RLS, triggers y columnas generadas
-- ejecutan estas funciones con el rol del usuario.
grant usage on schema private to authenticated, service_role;
revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema private grant execute on functions to authenticated, service_role;

-- ─── Compatibilidad temporal (se elimina en la siguiente migración) ────────

create view public.user_roles with (security_invoker = on) as select * from core.user_roles;
create view public.user_activity with (security_invoker = on) as select * from core.user_activity;
create view public.conciliacion_bancos with (security_invoker = on) as select * from conciliaciones.bancos;
create view public.anticipos_registros with (security_invoker = on) as select * from anticipos.registros;
create view public.colaboradores_retirados with (security_invoker = on) as select * from anticipos.retirados;
create view public.colaboradores_retirados_imports with (security_invoker = on) as select * from anticipos.retirados_imports;
create view public.comisiones_conceptos with (security_invoker = on) as select * from comisiones.conceptos;
create view public.comisiones_periodo_valores with (security_invoker = on) as select * from comisiones.periodo_valores;
create view public.comisiones_bases with (security_invoker = on) as select * from comisiones.bases;
create view public.comisiones_reconocimientos with (security_invoker = on) as select * from comisiones.reconocimientos;
create view public.comisiones_gasto_registrado with (security_invoker = on) as select * from comisiones.gasto_registrado;
create view public.comisiones_cierres with (security_invoker = on) as select * from comisiones.cierres;
create view public.netsuite_campos with (security_invoker = on) as select * from export_bancos.campos;
create view public.netsuite_campo_valores with (security_invoker = on) as select * from export_bancos.campo_valores;
create view public.export_bancos_plantillas with (security_invoker = on) as select * from export_bancos.plantillas;

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

create function public.touch_last_seen()
returns void
language sql
set search_path = ''
as $$ select core.touch_last_seen(); $$;

create function public.comisiones_guardar_cierre(p_periodo text, p_reconocimientos jsonb, p_cierre jsonb)
returns void
language sql
set search_path = ''
as $$ select comisiones.guardar_cierre(p_periodo, p_reconocimientos, p_cierre); $$;

create function public.match_colaborador_retirado(p_input text)
returns table(cedula numeric, nombre text, valor numeric, observacion text, fecha_reporte date, nivel text, tokens_comunes text[], tokens_extra text[])
language sql
stable
set search_path = ''
as $$ select * from anticipos.match_colaborador_retirado(p_input); $$;

create function public.match_colaborador_retirado_batch(p_inputs text[])
returns table(query text, cedula numeric, nombre text, valor numeric, observacion text, fecha_reporte date, nivel text, tokens_comunes text[], tokens_extra text[])
language sql
stable
set search_path = ''
as $$ select * from anticipos.match_colaborador_retirado_batch(p_inputs); $$;

revoke execute on function public.touch_last_seen() from public, anon;
revoke execute on function public.comisiones_guardar_cierre(text, jsonb, jsonb) from public, anon;
revoke execute on function public.match_colaborador_retirado(text) from public, anon;
revoke execute on function public.match_colaborador_retirado_batch(text[]) from public, anon;
grant execute on function public.touch_last_seen() to authenticated, service_role;
grant execute on function public.comisiones_guardar_cierre(text, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.match_colaborador_retirado(text) to authenticated, service_role;
grant execute on function public.match_colaborador_retirado_batch(text[]) to authenticated, service_role;

notify pgrst, 'reload schema';

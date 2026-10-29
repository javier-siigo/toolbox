-- Materializa el cruce anticipos ↔ excolaboradores en anticipos.registros.
--
-- Antes /ingresos/gestion-anticipos llamaba a match_colaborador_retirado_batch en cada carga
-- (un round-trip extra + el cruce completo). Ahora el resultado vive en el registro y solo se
-- recalcula cuando cambia algo que lo afecta:
--   · al insertar un registro o cambiarle el nombre  → trigger por fila (solo ese registro)
--   · al importar/editar/borrar excolaboradores      → trigger por sentencia (todos los registros,
--                                                      escribiendo solo los que cambian)
-- Los datos del excolaborador (nombre, valor, observación, fecha) se leen por la FK, así que
-- siempre están al día sin copiarlos.

alter table anticipos.registros
  add column retiro_cedula numeric references anticipos.retirados(cedula) on delete set null,
  add column retiro_nivel text check (retiro_nivel in ('exacto', 'exacto_inverso', 'parcial')),
  add column retiro_tokens_comunes text[],
  add column retiro_tokens_extra text[],
  add column es_retirado boolean generated always as (retiro_cedula is not null) stored;

create index registros_retiro_cedula_idx on anticipos.registros (retiro_cedula);

-- updated_at debe reflejar cambios de los usuarios, no los recálculos automáticos.
drop trigger anticipos_registros_set_updated_at on anticipos.registros;
create trigger anticipos_registros_set_updated_at
  before update of nombre, requerimiento, falta, observacion_1, observacion_2, fecha_rq, fecha_gestion, updated_by
  on anticipos.registros
  for each row execute function private.set_updated_at();

-- Un registro nuevo o renombrado: cruza solo ese nombre.
create function private.registros_marcar_retiro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  select * into m from anticipos.match_colaborador_retirado(new.nombre) limit 1;
  new.retiro_cedula := m.cedula;
  new.retiro_nivel := m.nivel;
  new.retiro_tokens_comunes := m.tokens_comunes;
  new.retiro_tokens_extra := m.tokens_extra;
  return new;
end;
$$;

create trigger registros_marcar_retiro
  before insert or update of nombre on anticipos.registros
  for each row execute function private.registros_marcar_retiro();

-- Recalcula todos los registros; solo escribe los que cambian.
create function private.recalcular_retiros()
returns void
language sql
security definer
set search_path = ''
as $$
  update anticipos.registros r
  set retiro_cedula = x.cedula,
      retiro_nivel = x.nivel,
      retiro_tokens_comunes = x.tokens_comunes,
      retiro_tokens_extra = x.tokens_extra
  from (
    select reg.id, m.cedula, m.nivel, m.tokens_comunes, m.tokens_extra
    from anticipos.registros reg
    left join anticipos.match_colaborador_retirado_batch(
      array(select distinct nombre from anticipos.registros)
    ) m on m.query = reg.nombre
  ) x
  where r.id = x.id
    and (r.retiro_cedula, r.retiro_nivel, r.retiro_tokens_comunes, r.retiro_tokens_extra)
        is distinct from (x.cedula, x.nivel, x.tokens_comunes, x.tokens_extra);
$$;

create function private.retirados_recalcular_registros()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recalcular_retiros();
  return null;
end;
$$;

create trigger retirados_recalcular_registros
  after insert or update or delete on anticipos.retirados
  for each statement execute function private.retirados_recalcular_registros();

revoke execute on function private.registros_marcar_retiro() from public, anon, authenticated;
revoke execute on function private.recalcular_retiros() from public, anon, authenticated;
revoke execute on function private.retirados_recalcular_registros() from public, anon, authenticated;

-- Backfill.
select private.recalcular_retiros();

notify pgrst, 'reload schema';

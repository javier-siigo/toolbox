-- Acelera el cruce anticipos ↔ excolaboradores.
--
-- `match_colaborador_retirado_batch` hacía un cross join (anticipos × retirados) y normalizaba
-- `r.nombre` tres veces por par: ~100k llamadas a `normalize_colaborador_name_unsorted` por
-- carga de /ingresos/gestion-anticipos (media 1,4 s, picos de 4,5 s con 83 × 409 filas).
--
-- Ahora los tokens de cada retirado se calculan una vez al escribir (columna generada) y el
-- cruce es un join por contención de arrays con índice GIN. Mismo resultado: verificado contra
-- la versión anterior con 238 entradas (incluye vacíos, signos, mayúsculas y orden invertido).

alter table anticipos.retirados
  add column tokens text[]
  generated always as (string_to_array(private.normalize_colaborador_name_unsorted(nombre), ' ')) stored;

create index retirados_tokens_gin on anticipos.retirados using gin (tokens);

create or replace function anticipos.match_colaborador_retirado_batch(p_inputs text[])
returns table(query text, cedula numeric, nombre text, valor numeric, observacion text, fecha_reporte date, nivel text, tokens_comunes text[], tokens_extra text[])
language sql
stable
set search_path = ''
as $$
  with inputs as (
    select q.input as query,
           string_to_array(private.normalize_colaborador_name_unsorted(q.input), ' ') as toks
    from unnest(p_inputs) as q(input)
    where length(trim(q.input)) > 0
  ),
  filtered as (
    select
      i.query,
      r.cedula,
      r.nombre,
      r.valor,
      r.observacion,
      r.fecha_reporte,
      case
        when r.tokens = i.toks then 'exacto'
        when r.tokens = (
          select array_agg(t.token::text order by t.ord desc)
          from unnest(i.toks) with ordinality as t(token, ord)
        ) then 'exacto_inverso'
        else 'parcial'
      end as lvl,
      array(select unnest(i.toks) intersect select unnest(r.tokens)) as comunes,
      array(select unnest(r.tokens) except select unnest(i.toks)) as extras
    from inputs i
    join anticipos.retirados r on r.tokens @> i.toks
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
          array_length(f.extras, 1),
          f.cedula
      ) as rn
    from filtered f
  )
  select r.query, r.cedula, r.nombre, r.valor, r.observacion, r.fecha_reporte, r.lvl, r.comunes, r.extras
  from ranked r
  where r.rn = 1;
$$;

create or replace function anticipos.match_colaborador_retirado(p_input text)
returns table(cedula numeric, nombre text, valor numeric, observacion text, fecha_reporte date, nivel text, tokens_comunes text[], tokens_extra text[])
language sql
stable
set search_path = ''
as $$
  with input as (
    select string_to_array(private.normalize_colaborador_name_unsorted(p_input), ' ') as toks
  ),
  scored as (
    select
      r.cedula,
      r.nombre,
      r.valor,
      r.observacion,
      r.fecha_reporte,
      case
        when r.tokens = i.toks then 'exacto'
        when r.tokens = (
          select array_agg(t.token::text order by t.ord desc)
          from unnest(i.toks) with ordinality as t(token, ord)
        ) then 'exacto_inverso'
        else 'parcial'
      end as lvl,
      array(select unnest(i.toks) intersect select unnest(r.tokens)) as comunes,
      array(select unnest(r.tokens) except select unnest(i.toks)) as extras
    from input i
    join anticipos.retirados r on r.tokens @> i.toks
  )
  select s.cedula, s.nombre, s.valor, s.observacion, s.fecha_reporte, s.lvl, s.comunes, s.extras
  from scored s
  order by
    case s.lvl
      when 'exacto' then 0
      when 'exacto_inverso' then 1
      else 2
    end,
    array_length(s.extras, 1),
    s.cedula;
$$;

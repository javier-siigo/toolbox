-- Servicios públicos: control y seguimiento de recibos (factura → registro → pago → soporte).
--
--   servicios_publicos.servicios            Catálogo de servicios esperados cada mes (proveedor,
--                                           referencia/cuenta, día de corte). No se borran: se desactivan.
--   servicios_publicos.recibos              Un recibo por servicio y mes. El estado NO se guarda a mano:
--                                           se deriva de las fechas (columna generada), y los checks
--                                           impiden combinaciones ambiguas (pagado sin registrar, etc.).
--   servicios_publicos.recibos_historial    Bitácora automática (trigger): creación, cambios de estado,
--                                           de valor y de soporte, con quién y cuándo.
--   servicios_publicos.preparar_mes(date)   Crea los recibos "pendiente de factura" del mes para los
--                                           servicios activos que aún no lo tienen (idempotente).
--   bucket servicios-publicos-soportes      Soportes de pago (PDF/imagen). Privado; el portal sube y
--                                           descarga con URLs firmadas tras autorizar. NO es temporal:
--                                           no está en la limpieza diaria (src/lib/storage/limpieza.ts).

create schema if not exists servicios_publicos;

grant usage on schema servicios_publicos to authenticated, service_role;
alter default privileges in schema servicios_publicos grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema servicios_publicos grant all on tables to service_role;
alter default privileges in schema servicios_publicos grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema servicios_publicos revoke execute on functions from public;
alter default privileges in schema servicios_publicos grant execute on functions to authenticated, service_role;

insert into core.procesos (id, area, nombre) values
  ('egresos.servicios-publicos', 'egresos', 'Servicios públicos');

-- ─── Catálogo ───────────────────────────────────────────────────────────────

create table servicios_publicos.servicios (
  id          uuid primary key default gen_random_uuid(),
  proveedor   text not null check (length(trim(proveedor)) between 2 and 120),
  servicio    text not null check (length(trim(servicio)) between 2 and 80),
  referencia  text check (length(referencia) <= 80),
  dia_corte   smallint check (dia_corte between 1 and 31),
  activo      boolean not null default true,
  notas       text check (length(notas) <= 500),
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null default auth.uid()
);

create unique index servicios_unicos on servicios_publicos.servicios
  (lower(proveedor), lower(servicio), lower(coalesce(referencia, '')));

create trigger servicios_set_updated_at
  before update on servicios_publicos.servicios
  for each row execute function private.set_updated_at();

-- ─── Recibos ────────────────────────────────────────────────────────────────

create table servicios_publicos.recibos (
  id                 uuid primary key default gen_random_uuid(),
  servicio_id        uuid not null references servicios_publicos.servicios (id) on delete restrict,
  mes                date not null check (extract(day from mes) = 1),
  referencia         text check (length(referencia) <= 80),
  valor              numeric(14, 2) check (valor >= 0),
  fecha_corte        date,
  fecha_recibido     date,
  fecha_registro     date,
  fecha_pago         date,
  soporte_path       text,
  soporte_nombre     text,
  soporte_subido_at  timestamptz,
  observaciones      text check (length(observaciones) <= 1000),
  estado             text generated always as (
    case
      when fecha_pago is not null then 'pagado'
      when fecha_registro is not null then 'registrado'
      when fecha_recibido is not null then 'recibido'
      else 'pendiente_factura'
    end
  ) stored,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users (id) on delete set null default auth.uid(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id) on delete set null default auth.uid(),

  constraint recibos_un_recibo_por_mes unique (servicio_id, mes),
  constraint recibos_registro_requiere_factura check (fecha_registro is null or fecha_recibido is not null),
  constraint recibos_registro_requiere_valor   check (fecha_registro is null or valor is not null),
  constraint recibos_pago_requiere_registro    check (fecha_pago is null or fecha_registro is not null),
  constraint recibos_registro_despues_factura  check (fecha_registro >= fecha_recibido),
  constraint recibos_pago_despues_registro     check (fecha_pago >= fecha_registro),
  constraint recibos_soporte_completo          check ((soporte_path is null) = (soporte_nombre is null)),
  constraint recibos_soporte_solo_pagado       check (soporte_path is null or fecha_pago is not null)
);

create index recibos_mes_idx on servicios_publicos.recibos (mes desc);
create index recibos_pendientes_idx on servicios_publicos.recibos (estado) where estado <> 'pagado';

create trigger recibos_set_updated_at
  before update on servicios_publicos.recibos
  for each row execute function private.set_updated_at();

-- ─── Historial ──────────────────────────────────────────────────────────────

create table servicios_publicos.recibos_historial (
  id         bigint generated always as identity primary key,
  recibo_id  uuid not null references servicios_publicos.recibos (id) on delete cascade,
  evento     text not null check (evento in ('creado', 'estado', 'valor', 'soporte')),
  detalle    text not null,
  usuario    text,
  at         timestamptz not null default now()
);

create index recibos_historial_recibo_idx on servicios_publicos.recibos_historial (recibo_id, at desc);

create function private.recibos_registrar_historial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  quien text := coalesce(auth.jwt() ->> 'email', 'sistema');
begin
  if tg_op = 'INSERT' then
    insert into servicios_publicos.recibos_historial (recibo_id, evento, detalle, usuario)
    values (new.id, 'creado', new.estado, quien);
    return null;
  end if;

  if new.estado is distinct from old.estado then
    insert into servicios_publicos.recibos_historial (recibo_id, evento, detalle, usuario)
    values (new.id, 'estado', old.estado || ' → ' || new.estado, quien);
  end if;
  if old.valor is not null and new.valor is distinct from old.valor then
    insert into servicios_publicos.recibos_historial (recibo_id, evento, detalle, usuario)
    values (new.id, 'valor', old.valor::text || ' → ' || coalesce(new.valor::text, 'sin valor'), quien);
  end if;
  if new.soporte_path is distinct from old.soporte_path then
    insert into servicios_publicos.recibos_historial (recibo_id, evento, detalle, usuario)
    values (
      new.id,
      'soporte',
      case
        when new.soporte_path is null then 'Quitado: ' || old.soporte_nombre
        when old.soporte_path is null then 'Adjuntado: ' || new.soporte_nombre
        else 'Reemplazado: ' || new.soporte_nombre
      end,
      quien
    );
  end if;
  return null;
end;
$$;

revoke execute on function private.recibos_registrar_historial() from public, anon, authenticated;

create trigger recibos_registrar_historial
  after insert or update on servicios_publicos.recibos
  for each row execute function private.recibos_registrar_historial();

-- ─── Preparar mes ───────────────────────────────────────────────────────────

-- Security invoker: la RLS de insert (nivel 'usar') aplica a quien la llama.
create function servicios_publicos.preparar_mes(p_mes date)
returns integer
language sql
set search_path = ''
as $$
  with mes as (
    select date_trunc('month', p_mes::timestamp)::date as inicio
  ),
  nuevos as (
    insert into servicios_publicos.recibos (servicio_id, mes, referencia, fecha_corte)
    select
      s.id,
      m.inicio,
      s.referencia,
      case when s.dia_corte is not null then
        m.inicio + (least(s.dia_corte, extract(day from (m.inicio + interval '1 month - 1 day'))::int) - 1)
      end
    from servicios_publicos.servicios s
    cross join mes m
    where s.activo
    on conflict (servicio_id, mes) do nothing
    returning 1
  )
  select count(*)::int from nuevos;
$$;

-- ─── Grants y RLS ───────────────────────────────────────────────────────────

grant select, insert, update, delete on all tables in schema servicios_publicos to authenticated;
grant all on all tables in schema servicios_publicos to service_role;
grant usage, select on all sequences in schema servicios_publicos to authenticated, service_role;
revoke execute on all functions in schema servicios_publicos from public, anon;
grant execute on all functions in schema servicios_publicos to authenticated, service_role;

alter table servicios_publicos.servicios enable row level security;
alter table servicios_publicos.recibos enable row level security;
alter table servicios_publicos.recibos_historial enable row level security;

create policy servicios_ver on servicios_publicos.servicios for select to authenticated
  using (private.tiene_acceso('egresos.servicios-publicos', 'ver'));
create policy servicios_crear on servicios_publicos.servicios for insert to authenticated
  with check (private.tiene_acceso('egresos.servicios-publicos', 'usar'));
create policy servicios_editar on servicios_publicos.servicios for update to authenticated
  using (private.tiene_acceso('egresos.servicios-publicos', 'usar'))
  with check (private.tiene_acceso('egresos.servicios-publicos', 'usar'));

create policy recibos_ver on servicios_publicos.recibos for select to authenticated
  using (private.tiene_acceso('egresos.servicios-publicos', 'ver'));
create policy recibos_crear on servicios_publicos.recibos for insert to authenticated
  with check (private.tiene_acceso('egresos.servicios-publicos', 'usar'));
create policy recibos_editar on servicios_publicos.recibos for update to authenticated
  using (private.tiene_acceso('egresos.servicios-publicos', 'usar'))
  with check (private.tiene_acceso('egresos.servicios-publicos', 'usar'));
create policy recibos_borrar on servicios_publicos.recibos for delete to authenticated
  using (private.tiene_acceso('egresos.servicios-publicos', 'usar'));

-- Solo lectura: lo escribe el trigger (security definer).
create policy historial_ver on servicios_publicos.recibos_historial for select to authenticated
  using (private.tiene_acceso('egresos.servicios-publicos', 'ver'));
revoke insert, update, delete on servicios_publicos.recibos_historial from authenticated;

-- ─── Storage ────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'servicios-publicos-soportes',
  'servicios-publicos-soportes',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic']
);

notify pgrst, 'reload schema';

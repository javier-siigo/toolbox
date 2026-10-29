-- Permisos por proceso (reemplaza los roles fijos admin/conciliaciones/ingresos + países).
--
--   core.procesos   Catálogo: un id estable por proceso ('ingresos.gestion-anticipos').
--                   El mismo id vive en src/lib/auth/permisos-shared.ts (PROCESOS).
--   core.permisos   Usuario × proceso × nivel. Niveles ordenados: ver < usar < gestionar.
--                     ver        leer (y exportar) sin modificar nada.
--                     usar       operar el proceso: crear, editar, ejecutar.
--                     gestionar  además, configurarlo (p. ej. catálogo de campos NetSuite).
--   core.usuarios   Solo el flag de superusuario (es_admin): todo, más la administración.
--
-- RLS usa una sola función: private.tiene_acceso(proceso, nivel).
--
-- Los permisos actuales se traducen 1:1 (nadie gana ni pierde acceso):
--   admin                → es_admin
--   ingresos             → usar en los 4 procesos de Ingresos
--   conciliaciones+país  → usar en conciliaciones.<país>
-- `core.user_roles` y `private.current_user_has_role` se mantienen hasta desplegar el código
-- nuevo; se eliminan en la migración siguiente.

-- ─── Catálogo ───────────────────────────────────────────────────────────────

create table core.procesos (
  id     text primary key check (id ~ '^[a-z0-9-]+\.[a-z0-9-]+$'),
  area   text not null,
  nombre text not null,
  pais   text unique,
  activo boolean not null default true
);

insert into core.procesos (id, area, nombre, pais) values
  ('conciliaciones.chile',    'conciliaciones', 'Conciliación Chile',    'CL'),
  ('conciliaciones.colombia', 'conciliaciones', 'Conciliación Colombia', 'CO'),
  ('conciliaciones.ecuador',  'conciliaciones', 'Conciliación Ecuador',  'EC'),
  ('conciliaciones.mexico',   'conciliaciones', 'Conciliación México',   'MX'),
  ('conciliaciones.uruguay',  'conciliaciones', 'Conciliación Uruguay',  'UY'),
  ('ingresos.gestion-anticipos',  'ingresos', 'Gestión y Legalización de Anticipos', null),
  ('ingresos.notas-credito',      'ingresos', 'Notas crédito',                       null),
  ('ingresos.calculo-comisiones', 'ingresos', 'Cálculo de Comisiones',               null),
  ('ingresos.export-bancos',      'ingresos', 'Auditoría Asientos de Diario',        null);

create type core.nivel_acceso as enum ('ver', 'usar', 'gestionar');

create table core.permisos (
  user_id      uuid not null references auth.users (id) on delete cascade,
  proceso_id   text not null references core.procesos (id) on update cascade on delete cascade,
  nivel        core.nivel_acceso not null default 'usar',
  otorgado_por uuid references auth.users (id) on delete set null,
  otorgado_at  timestamptz not null default now(),
  primary key (user_id, proceso_id)
);

create table core.usuarios (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  es_admin boolean not null default false
);

-- Solo service role (pantalla de admin y lectura de permisos del servidor) y la función de abajo.
alter table core.permisos enable row level security;
alter table core.usuarios enable row level security;

-- El catálogo no es sensible y lo necesitan las políticas de conciliaciones.
alter table core.procesos enable row level security;
create policy procesos_lectura on core.procesos for select to authenticated using (true);
revoke insert, update, delete on core.procesos from authenticated;

-- ─── Función de acceso ──────────────────────────────────────────────────────

create function private.tiene_acceso(p_proceso text, p_nivel core.nivel_acceso default 'ver')
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from core.usuarios u where u.user_id = auth.uid() and u.es_admin)
      or exists (
        select 1
        from core.permisos p
        where p.user_id = auth.uid()
          and p.proceso_id = p_proceso
          and p.nivel >= p_nivel
      );
$$;

revoke execute on function private.tiene_acceso(text, core.nivel_acceso) from public, anon;
grant execute on function private.tiene_acceso(text, core.nivel_acceso) to authenticated, service_role;

-- ─── Traducción de los roles actuales ───────────────────────────────────────

insert into core.usuarios (user_id, es_admin)
select user_id, 'admin' = any(roles)
from core.user_roles;

insert into core.permisos (user_id, proceso_id, nivel)
select ur.user_id, p.id, 'usar'
from core.user_roles ur
join core.procesos p on p.area = 'ingresos'
where 'ingresos' = any(ur.roles);

insert into core.permisos (user_id, proceso_id, nivel)
select ur.user_id, p.id, 'usar'
from core.user_roles ur
join core.procesos p on p.area = 'conciliaciones' and p.pais = any(ur.paises)
where 'conciliaciones' = any(ur.roles);

-- ─── Políticas RLS ──────────────────────────────────────────────────────────
-- Patrón: SELECT con 'ver'; escrituras con 'usar' (o 'gestionar' para configuración).

-- anticipos
drop policy anticipos_select_ingresos on anticipos.registros;
drop policy anticipos_insert_ingresos on anticipos.registros;
drop policy anticipos_update_ingresos on anticipos.registros;
drop policy anticipos_delete_ingresos on anticipos.registros;

create policy registros_ver on anticipos.registros for select to authenticated
  using (private.tiene_acceso('ingresos.gestion-anticipos', 'ver'));
create policy registros_crear on anticipos.registros for insert to authenticated
  with check (
    private.tiene_acceso('ingresos.gestion-anticipos', 'usar')
    and created_by = auth.uid()
    and updated_by = auth.uid()
  );
create policy registros_editar on anticipos.registros for update to authenticated
  using (private.tiene_acceso('ingresos.gestion-anticipos', 'usar'))
  with check (private.tiene_acceso('ingresos.gestion-anticipos', 'usar') and updated_by = auth.uid());
create policy registros_borrar on anticipos.registros for delete to authenticated
  using (private.tiene_acceso('ingresos.gestion-anticipos', 'usar'));

-- Antes cualquier usuario con sesión leía el reporte de excolaboradores.
drop policy "read retirados" on anticipos.retirados;
drop policy "read imports" on anticipos.retirados_imports;
create policy retirados_ver on anticipos.retirados for select to authenticated
  using (private.tiene_acceso('ingresos.gestion-anticipos', 'ver'));
create policy retirados_imports_ver on anticipos.retirados_imports for select to authenticated
  using (private.tiene_acceso('ingresos.gestion-anticipos', 'ver'));

-- comisiones: dos políticas por tabla (permisivas, se suman): leer con 'ver', todo con 'usar'.
do $$
declare
  t text;
begin
  foreach t in array array['conceptos', 'periodo_valores', 'bases', 'reconocimientos', 'gasto_registrado', 'cierres'] loop
    execute format('drop policy comisiones_%s_ingresos_all on comisiones.%I', t, t);
    execute format(
      'create policy %I on comisiones.%I for select to authenticated using (private.tiene_acceso(''ingresos.calculo-comisiones'', ''ver''))',
      t || '_ver', t);
    execute format(
      'create policy %I on comisiones.%I for all to authenticated using (private.tiene_acceso(''ingresos.calculo-comisiones'', ''usar'')) with check (private.tiene_acceso(''ingresos.calculo-comisiones'', ''usar''))',
      t || '_usar', t);
  end loop;
end $$;

-- export_bancos
drop policy export_bancos_plantillas_ingresos_all on export_bancos.plantillas;
create policy plantillas_ver on export_bancos.plantillas for select to authenticated
  using (private.tiene_acceso('ingresos.export-bancos', 'ver'));
create policy plantillas_usar on export_bancos.plantillas for all to authenticated
  using (private.tiene_acceso('ingresos.export-bancos', 'usar'))
  with check (private.tiene_acceso('ingresos.export-bancos', 'usar'));

drop policy netsuite_campos_ingresos_select on export_bancos.campos;
drop policy netsuite_campos_admin_write on export_bancos.campos;
create policy campos_ver on export_bancos.campos for select to authenticated
  using (private.tiene_acceso('ingresos.export-bancos', 'ver'));
create policy campos_gestionar on export_bancos.campos for all to authenticated
  using (private.tiene_acceso('ingresos.export-bancos', 'gestionar'))
  with check (private.tiene_acceso('ingresos.export-bancos', 'gestionar'));

-- conciliaciones: cada banco lo ve quien tenga acceso al proceso de su país.
drop policy "Usuarios autenticados leen bancos activos" on conciliaciones.bancos;
create policy bancos_ver on conciliaciones.bancos for select to authenticated
  using (
    activo
    and exists (
      select 1 from core.procesos p
      where p.pais = bancos.pais
        and private.tiene_acceso(p.id, 'ver')
    )
  );

notify pgrst, 'reload schema';

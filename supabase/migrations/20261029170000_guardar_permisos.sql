-- Guarda de una vez el flag de admin y todos los permisos de un usuario (reemplaza los anteriores).
-- Atómico: la pantalla de admin no puede dejar a alguien con la mitad de los cambios.
-- Solo service role; la server action valida antes que quien llama sea admin.

create function core.guardar_permisos(
  p_user_id uuid,
  p_es_admin boolean,
  p_permisos jsonb,          -- {"ingresos.gestion-anticipos": "usar", ...}
  p_otorgado_por uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into core.usuarios (user_id, es_admin)
  values (p_user_id, p_es_admin)
  on conflict (user_id) do update set es_admin = excluded.es_admin;

  delete from core.permisos
  where user_id = p_user_id
    and not (proceso_id = any(array(select jsonb_object_keys(p_permisos))));

  insert into core.permisos (user_id, proceso_id, nivel, otorgado_por, otorgado_at)
  select p_user_id, k, v::core.nivel_acceso, p_otorgado_por, now()
  from jsonb_each_text(p_permisos) as e(k, v)
  on conflict (user_id, proceso_id) do update
    set nivel = excluded.nivel,
        otorgado_por = excluded.otorgado_por,
        otorgado_at = excluded.otorgado_at
    where core.permisos.nivel is distinct from excluded.nivel;
end;
$$;

revoke execute on function core.guardar_permisos(uuid, boolean, jsonb, uuid) from public, anon, authenticated;
grant execute on function core.guardar_permisos(uuid, boolean, jsonb, uuid) to service_role;

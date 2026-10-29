-- Lista objetos de Storage más viejos que `p_antes` en los buckets indicados.
--
-- Storage bloquea `delete from storage.objects` (trigger protect_delete) porque dejaría el
-- archivo huérfano en S3, así que la limpieza borra por Storage API (ruta
-- /api/cron/limpiar-storage). Esta función solo le da la lista sin tener que recorrer
-- carpetas con `list()`.
--
-- Solo service_role: expone nombres de archivo de todos los usuarios.

create or replace function core.storage_archivos_vencidos(p_buckets text[], p_antes timestamptz)
returns table(bucket_id text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id = any(p_buckets)
    and o.created_at < p_antes
  order by o.bucket_id, o.created_at;
$$;

revoke execute on function core.storage_archivos_vencidos(text[], timestamptz) from public, anon, authenticated;
grant execute on function core.storage_archivos_vencidos(text[], timestamptz) to service_role;

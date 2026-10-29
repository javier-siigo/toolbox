-- Elimina el modelo de roles anterior (reemplazado por core.permisos en 20261029160000).
-- Aplicar SOLO cuando el portal desplegado ya use src/lib/auth/acceso.ts: la versión vieja
-- lee core.user_roles para el menú y la pantalla de admin.

drop table core.user_roles;
drop function private.current_user_has_role(text);

notify pgrst, 'reload schema';

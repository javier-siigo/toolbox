-- Reorganiza las áreas del menú: Ingresos y Egresos se unen en "ingresos-egresos" y la
-- Auditoría de Asientos de Diario pasa a "reportes".
--
-- Solo cambia la columna informativa `area`. Los ids (`ingresos.gestion-anticipos`,
-- `egresos.servicios-publicos`, `ingresos.export-bancos`, …) NO cambian: son la llave de
-- core.permisos y de las políticas RLS (private.tiene_acceso), y renombrarlos obligaría a
-- migrar permisos y políticas sin ningún beneficio para el usuario.

update core.procesos set area = 'ingresos-egresos' where area in ('ingresos', 'egresos') and id <> 'ingresos.export-bancos';
update core.procesos set area = 'reportes' where id = 'ingresos.export-bancos';

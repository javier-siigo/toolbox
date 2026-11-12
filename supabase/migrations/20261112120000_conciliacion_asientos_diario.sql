-- Conciliación de asientos de diario vs balance (no depende de un país).
--   - Proceso propio para permisos: conciliaciones.asientos-diario.
--   - El archivo de asientos puede pesar hasta 50 MB (la ruta valida 10 MB para el balance
--     y para los demás flujos de conciliaciones), así que el bucket sube su límite a 50 MB.

insert into core.procesos (id, area, nombre, pais) values
  ('conciliaciones.asientos-diario', 'conciliaciones', 'Conciliación asientos de diario', null)
on conflict (id) do nothing;

update storage.buckets
set file_size_limit = 52428800
where id = 'conciliaciones-uploads';

-- Conciliación 1305: terceros con saldo negativo en la cartera a una fecha de corte.
--   - Proceso propio para permisos: conciliaciones.cartera-1305.
--   - Solo consulta NetSuite desde el portal: no usa Storage ni n8n.

insert into core.procesos (id, area, nombre, pais) values
  ('conciliaciones.cartera-1305', 'conciliaciones', 'Conciliación 1305', null)
on conflict (id) do nothing;

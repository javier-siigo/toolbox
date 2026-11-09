-- Índice para la carga de la página de anticipos.
--
-- anticipos.registros: getAnticiposAll() hace ORDER BY created_at DESC LIMIT 1000. Sin índice,
-- Postgres lee y ordena toda la tabla en cada carga de la página; con él, recorre el índice y
-- se detiene en el límite.
create index if not exists registros_created_at_idx
  on anticipos.registros (created_at desc);


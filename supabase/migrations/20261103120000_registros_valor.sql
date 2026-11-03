-- Valor del anticipo (pesos COP) en cada registro de gestión de anticipos.
-- Nullable: los registros existentes no tienen valor capturado.

alter table anticipos.registros
  add column valor numeric(14, 0) check (valor is null or valor >= 0);

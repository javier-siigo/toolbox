-- Periodo de conciliación por banco.
--
-- Los contadores definen en el portal, para cada banco, el mes que se está
-- conciliando (`periodo`, primer día del mes) y hasta qué día se sigue
-- trabajando ese mes por el cierre (`periodo_cierre`, p. ej. noviembre hasta el
-- 3 de diciembre). n8n solo tiene en cuenta los registros cuya fecha cae dentro
-- del mes del periodo; los de otros meses se descartan.
--
-- Pasada la fecha de cierre (o sin configurar) el periodo vigente es el mes en
-- curso del país. La regla vive en src/lib/conciliaciones/periodo.ts.

alter table conciliaciones.bancos
  add column periodo date,
  add column periodo_cierre date,
  add column periodo_actualizado_por uuid references auth.users (id) on delete set null,
  add column periodo_actualizado_en timestamptz;

alter table conciliaciones.bancos
  add constraint bancos_periodo_primer_dia
    check (periodo is null or extract(day from periodo) = 1),
  add constraint bancos_periodo_completo
    check ((periodo is null) = (periodo_cierre is null)),
  -- El cierre no puede ser antes del último día del mes que se concilia.
  add constraint bancos_periodo_cierre_despues_mes
    check (periodo_cierre is null or periodo_cierre >= (periodo + interval '1 month' - interval '1 day')::date);

comment on column conciliaciones.bancos.periodo is 'Mes que se concilia (primer día del mes).';
comment on column conciliaciones.bancos.periodo_cierre is 'Último día en que se sigue conciliando `periodo` (cierre contable).';

notify pgrst, 'reload schema';

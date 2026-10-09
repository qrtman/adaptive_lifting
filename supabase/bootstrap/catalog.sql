-- Read-only structural snapshot. No application rows, credentials or Vault data.
WITH app_tables AS (
  SELECT c.oid,c.relname,c.relrowsecurity FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND c.relname <> 'alembic_version'
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e')
), cols AS (
  SELECT t.relname AS "table", a.attname AS name,
    format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null,
    pg_get_expr(d.adbin,d.adrelid) AS "default", a.attidentity AS identity,
    a.attgenerated AS generated
  FROM app_tables t JOIN pg_attribute a ON a.attrelid=t.oid
  LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum
  WHERE a.attnum>0 AND NOT a.attisdropped
), cons AS (
  SELECT t.relname AS "table",c.conname AS name,c.contype AS type,
    pg_get_constraintdef(c.oid,true) AS definition,
    c.convalidated AS validated,c.condeferrable AS deferrable,c.condeferred AS deferred
  FROM app_tables t JOIN pg_constraint c ON c.conrelid=t.oid
), idx AS (
  SELECT t.relname AS "table",i.relname AS name,
    pg_get_indexdef(i.oid) AS definition,x.indisvalid AS valid,x.indisready AS ready
  FROM app_tables t JOIN pg_index x ON x.indrelid=t.oid JOIN pg_class i ON i.oid=x.indexrelid
), seq AS (
  SELECT s.sequencename AS name,s.data_type,s.start_value,s.min_value,s.max_value,
    s.increment_by,s.cycle,s.cache_size,t.relname AS owned_table,a.attname AS owned_column
  FROM pg_sequences s JOIN pg_namespace n ON n.nspname=s.schemaname
  JOIN pg_class q ON q.relnamespace=n.oid AND q.relname=s.sequencename
  LEFT JOIN pg_depend d ON d.objid=q.oid AND d.deptype IN ('a','i')
  LEFT JOIN app_tables t ON t.oid=d.refobjid
  LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
  WHERE s.schemaname='public' AND t.oid IS NOT NULL
)
SELECT jsonb_build_object(
  'tables',coalesce((SELECT jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity) ORDER BY relname) FROM app_tables),'[]'::jsonb),
  'columns',coalesce((SELECT jsonb_agg(to_jsonb(cols) ORDER BY "table",name) FROM cols),'[]'::jsonb),
  'constraints',coalesce((SELECT jsonb_agg(to_jsonb(cons) ORDER BY "table",name) FROM cons),'[]'::jsonb),
  'indexes',coalesce((SELECT jsonb_agg(to_jsonb(idx) ORDER BY "table",name) FROM idx),'[]'::jsonb),
  'sequences',coalesce((SELECT jsonb_agg(to_jsonb(seq) ORDER BY name) FROM seq),'[]'::jsonb)
) AS catalog;

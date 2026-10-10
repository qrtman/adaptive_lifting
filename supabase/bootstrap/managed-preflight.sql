-- Fail-closed checks for a new, empty managed Supabase project.
-- Reads only identity, catalog and row counts; emits no application records.
DO $preflight$
DECLARE
  v_count bigint;
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Expected the Supabase postgres database';
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f');
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Refusing nonempty public application schema (% objects)', v_count;
  END IF;

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM supabase_migrations.schema_migrations' INTO v_count;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'Refusing a target with existing migration history (% rows)', v_count;
    END IF;
  END IF;

  IF pg_catalog.to_regclass('auth.users') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM auth.users' INTO v_count;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Refusing target with existing Auth users'; END IF;
  END IF;
  IF pg_catalog.to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM storage.objects' INTO v_count;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Refusing target with existing Storage objects'; END IF;
  END IF;
  IF pg_catalog.to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM storage.buckets' INTO v_count;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Refusing target with existing Storage buckets'; END IF;
  END IF;
END
$preflight$;

SELECT jsonb_build_object(
  'database', current_database(),
  'database_user', current_user,
  'public_objects', (
    SELECT count(*) FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
  ),
  'migration_ledger_exists', pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
  'checked', true
) AS preflight;

-- Fail-closed checks for a new, empty managed Supabase project.
-- Reads only identity, catalog and row counts; emits no application records.
DO $preflight$
DECLARE
  v_count bigint;
  v_relation text;
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

  SELECT count(*) INTO v_count
  FROM pg_catalog.pg_namespace
  WHERE nspname LIKE 'al\_%' ESCAPE '\';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Refusing a target with pre-existing application schemas';
  END IF;

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM supabase_migrations.schema_migrations' INTO v_count;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'Refusing a target with existing migration history (% rows)', v_count;
    END IF;
  END IF;

  FOREACH v_relation IN ARRAY ARRAY[
    'auth.users', 'auth.identities', 'auth.sessions', 'auth.refresh_tokens',
    'auth.mfa_factors', 'storage.objects', 'storage.buckets', 'cron.job'
  ] LOOP
    IF pg_catalog.to_regclass(v_relation) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %s', pg_catalog.to_regclass(v_relation)) INTO v_count;
      IF v_count <> 0 THEN
        RAISE EXCEPTION 'Refusing target with existing user data in %', v_relation;
      END IF;
    END IF;
  END LOOP;

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

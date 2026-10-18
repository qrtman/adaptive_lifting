-- Structural/security assertions after the exact 63 migrations are applied.
-- Platform-level Data API, Edge secrets and allowed origins are checked in the
-- operator checklist because those settings are not represented by pg_catalog.
DO $postflight$
DECLARE
  v_count bigint;
  v_table record;
  v_role text;
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'Unexpected database'; END IF;
  SELECT count(*) INTO v_count FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> 'alembic_version'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.objid=c.oid AND d.deptype='e');
  IF v_count <> 36 THEN RAISE EXCEPTION 'Expected 36 application tables; found %', v_count; END IF;
  SELECT count(*) INTO v_count FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname <> 'alembic_version'
      AND a.attnum>0 AND NOT a.attisdropped
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.objid=c.oid AND d.deptype='e');
  IF v_count <> 302 THEN RAISE EXCEPTION 'Expected 302 application columns after migration 63; found %', v_count; END IF;
  SELECT count(*) INTO v_count FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname <> 'alembic_version';
  IF v_count <> 99 THEN RAISE EXCEPTION 'Expected 99 application constraints after migration 63; found %', v_count; END IF;
  SELECT count(*) INTO v_count FROM pg_catalog.pg_index x
    JOIN pg_catalog.pg_class t ON t.oid=x.indrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname <> 'alembic_version';
  IF v_count <> 98 THEN RAISE EXCEPTION 'Expected 98 application indexes; found %', v_count; END IF;

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'Supabase migration ledger is absent';
  END IF;
  EXECUTE 'SELECT count(*) FROM supabase_migrations.schema_migrations' INTO v_count;
  IF v_count <> 63 THEN RAISE EXCEPTION 'Expected exactly 63 migration records; found %', v_count; END IF;

  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF pg_catalog.has_schema_privilege(v_role, 'al_private', 'USAGE') THEN
      RAISE EXCEPTION 'Browser role % has access to al_private', v_role;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='al_private' AND pg_catalog.has_function_privilege(v_role,p.oid,'EXECUTE')
    ) THEN RAISE EXCEPTION 'Browser role % can execute private RPCs', v_role; END IF;
    FOR v_table IN SELECT c.oid,c.relname FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
    LOOP
      IF pg_catalog.has_table_privilege(v_role,v_table.oid,'SELECT') OR
         pg_catalog.has_table_privilege(v_role,v_table.oid,'INSERT') OR
         pg_catalog.has_table_privilege(v_role,v_table.oid,'UPDATE') OR
         pg_catalog.has_table_privilege(v_role,v_table.oid,'DELETE') THEN
        RAISE EXCEPTION 'Browser role % has direct table access to public.%', v_role,v_table.relname;
      END IF;
    END LOOP;
  END LOOP;

  IF pg_catalog.to_regclass('public.workouts') IS NULL OR
     pg_catalog.to_regclass('public.exercises') IS NULL OR
     pg_catalog.to_regclass('public.exercise_sets') IS NULL THEN
    RAISE EXCEPTION 'Revision-controlled training tables are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.workouts'::regclass AND attname='revision' AND attnotnull) OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.exercises'::regclass AND attname='revision' AND attnotnull) OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.exercise_sets'::regclass AND attname='revision' AND attnotnull) THEN
    RAISE EXCEPTION 'Server-issued workout revision columns are missing';
  END IF;
  IF pg_catalog.to_regclass('vault.decrypted_secrets') IS NULL OR
     pg_catalog.to_regclass('realtime.messages') IS NULL OR
     pg_catalog.to_regprocedure('realtime.topic()') IS NULL OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_cron') OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_net') OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname='supabase_vault') THEN
    RAISE EXCEPTION 'Managed Vault, Realtime, Cron or pg_net prerequisite is absent';
  END IF;

  IF pg_catalog.to_regprocedure('al_private.al_workout_sync(text,text,text,text,text,boolean,integer,jsonb)') IS NULL OR
     pg_catalog.to_regprocedure('al_private.al_microcycles_read_with_revisions(text,text,text,boolean)') IS NULL OR
     pg_catalog.to_regprocedure('al_private.al_session_replace_exercise_sets_checked(text,text,text,text,bigint,boolean,integer,jsonb)') IS NULL OR
     pg_catalog.to_regprocedure('al_private.al_set_log_checked(text,text,text,text,text,double precision,integer,double precision,text,double precision,integer,double precision,boolean,integer,bigint)') IS NULL THEN
    RAISE EXCEPTION 'Revision-aware private RPC set is incomplete';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='al_edge_catalog_runtime'
    AND r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
    AND NOT r.rolreplication AND NOT r.rolbypassrls) THEN
    RAISE EXCEPTION 'Restricted Edge runtime login role is missing or escalated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname='al_realtime_subscriber'
    AND NOT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
    AND NOT r.rolreplication AND NOT r.rolbypassrls) THEN
    RAISE EXCEPTION 'Restricted Realtime NOLOGIN role is missing or escalated';
  END IF;
  IF NOT pg_catalog.has_function_privilege('al_edge_catalog_runtime',
      'al_private.al_workout_sync(text,text,text,text,text,boolean,integer,jsonb)','EXECUTE') OR
     NOT pg_catalog.has_function_privilege('al_edge_catalog_runtime',
      'al_private.al_microcycles_read_with_revisions(text,text,text,boolean)','EXECUTE') OR
     NOT pg_catalog.has_function_privilege('al_edge_catalog_runtime',
      'al_private.al_session_replace_exercise_sets_checked(text,text,text,text,bigint,boolean,integer,jsonb)','EXECUTE') OR
     NOT pg_catalog.has_function_privilege('al_edge_catalog_runtime',
      'al_private.al_set_log_checked(text,text,text,text,text,double precision,integer,double precision,text,double precision,integer,double precision,boolean,integer,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'The restricted Edge role is missing required revision-aware RPC grants';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname IN (
        'workouts_revision_before_update','exercises_revision_before_update',
        'exercise_sets_revision_before_update','exercise_sets_revision_parent_after_write'
      )) <> 4 THEN
    RAISE EXCEPTION 'Revision bump triggers are incomplete';
  END IF;
END
$postflight$;

SELECT 'managed-postflight=PASS' AS result;

-- Read-only inspection of managed Realtime metadata. No row data is selected.
SELECT pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
  'messages_table', (
    SELECT pg_catalog.jsonb_build_object(
      'schema', n.nspname,
      'name', c.relname,
      'kind', c.relkind,
      'owner', pg_catalog.pg_get_userbyid(c.relowner),
      'row_security_enabled', c.relrowsecurity,
      'force_row_security', c.relforcerowsecurity,
      'partition_key', pg_catalog.pg_get_partkeydef(c.oid),
      'partitions', coalesce((
        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', child.relname,
          'bound', pg_catalog.pg_get_expr(child.relpartbound, child.oid)
        ) ORDER BY child.relname)
        FROM pg_catalog.pg_inherits i
        JOIN pg_catalog.pg_class child ON child.oid=i.inhrelid
        WHERE i.inhparent=c.oid
      ), '[]'::jsonb)
    )
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='realtime' AND c.relname='messages'
  ),
  'policies', coalesce((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', p.policyname,
      'permissive', p.permissive,
      'roles', p.roles,
      'command', p.cmd,
      'using', p.qual,
      'check', p.with_check
    ) ORDER BY p.policyname)
    FROM pg_catalog.pg_policies p
    WHERE p.schemaname='realtime' AND p.tablename='messages'
  ), '[]'::jsonb),
  'subscriber_role', (
    SELECT pg_catalog.jsonb_build_object(
      'exists', true,
      'login', r.rolcanlogin,
      'inherit', r.rolinherit,
      'superuser', r.rolsuper,
      'create_database', r.rolcreatedb,
      'create_role', r.rolcreaterole,
      'replication', r.rolreplication,
      'bypass_rls', r.rolbypassrls,
      'schema_usage', pg_catalog.has_schema_privilege(r.rolname, 'realtime', 'USAGE'),
      'schema_create', pg_catalog.has_schema_privilege(r.rolname, 'realtime', 'CREATE'),
      'table_select', pg_catalog.has_table_privilege(r.rolname, 'realtime.messages', 'SELECT'),
      'table_insert', pg_catalog.has_table_privilege(r.rolname, 'realtime.messages', 'INSERT'),
      'table_update', pg_catalog.has_table_privilege(r.rolname, 'realtime.messages', 'UPDATE'),
      'table_delete', pg_catalog.has_table_privilege(r.rolname, 'realtime.messages', 'DELETE')
    )
    FROM pg_catalog.pg_roles r WHERE r.rolname='al_realtime_subscriber'
  ),
  'realtime_topic_function_exists', pg_catalog.to_regprocedure('realtime.topic()') IS NOT NULL
));

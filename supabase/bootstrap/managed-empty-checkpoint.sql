-- Read-only structural snapshot for the initial empty production database.
-- Contains no table rows, credential values, or restorable DDL.
SELECT pg_catalog.jsonb_pretty(pg_catalog.jsonb_build_object(
  'format', 'adaptive-lifting-empty-database-catalog-v1',
  'database', current_database(),
  'effective_user', current_user,
  'server_version', current_setting('server_version'),
  'server_version_num', current_setting('server_version_num'),
  'database_metadata', (
    SELECT jsonb_build_object(
      'owner', pg_get_userbyid(d.datdba),
      'encoding', pg_encoding_to_char(d.encoding),
      'collation', d.datcollate,
      'character_type', d.datctype,
      'tablespace', t.spcname,
      'connection_limit', d.datconnlimit,
      'acl', d.datacl::text
    )
    FROM pg_catalog.pg_database d
    JOIN pg_catalog.pg_tablespace t ON t.oid=d.dattablespace
    WHERE d.datname=current_database()
  ),
  'schemas', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'name', n.nspname,
      'owner', pg_get_userbyid(n.nspowner),
      'acl', n.nspacl::text
    ) ORDER BY n.nspname)
    FROM pg_catalog.pg_namespace n
    WHERE n.nspname !~ '^pg_(catalog|toast)'
      AND n.nspname <> 'information_schema'
  ), '[]'::jsonb),
  'extensions', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'name', e.extname,
      'version', e.extversion,
      'schema', n.nspname
    ) ORDER BY e.extname)
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
  ), '[]'::jsonb),
  'relations', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'name', c.relname,
      'kind', c.relkind,
      'owner', pg_get_userbyid(c.relowner),
      'persistence', c.relpersistence,
      'row_security', c.relrowsecurity,
      'force_row_security', c.relforcerowsecurity,
      'acl', c.relacl::text,
      'view_definition', CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END,
      'sequence_options', (
        SELECT jsonb_build_object(
          'start', s.seqstart,
          'increment', s.seqincrement,
          'maximum', s.seqmax,
          'minimum', s.seqmin,
          'cache', s.seqcache,
          'cycle', s.seqcycle
        ) FROM pg_catalog.pg_sequence s WHERE s.seqrelid=c.oid
      ),
      'columns', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'name', a.attname,
          'type', format_type(a.atttypid,a.atttypmod),
          'not_null', a.attnotnull,
          'identity', a.attidentity,
          'generated', a.attgenerated,
          'default', pg_get_expr(d.adbin,d.adrelid)
        ) ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      ), '[]'::jsonb),
      'constraints', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'name', con.conname,
          'type', con.contype,
          'validated', con.convalidated,
          'definition', pg_get_constraintdef(con.oid,true)
        ) ORDER BY con.conname)
        FROM pg_catalog.pg_constraint con WHERE con.conrelid=c.oid
      ), '[]'::jsonb),
      'indexes', coalesce((
        SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY ic.relname)
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
        WHERE i.indrelid=c.oid
      ), '[]'::jsonb),
      'triggers', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'name', t.tgname,
          'enabled', t.tgenabled,
          'definition', pg_get_triggerdef(t.oid,true)
        ) ORDER BY t.tgname)
        FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal
      ), '[]'::jsonb),
      'policies', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'name', p.polname,
          'command', p.polcmd,
          'permissive', p.polpermissive,
          'roles', p.polroles,
          'using', pg_get_expr(p.polqual,p.polrelid),
          'check', pg_get_expr(p.polwithcheck,p.polrelid)
        ) ORDER BY p.polname)
        FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid
      ), '[]'::jsonb)
    ) ORDER BY n.nspname,c.relname)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_(catalog|toast)'
      AND n.nspname <> 'information_schema'
      AND c.relkind IN ('r','p','v','m','S','f','i','I')
  ), '[]'::jsonb),
  'types', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'name', t.typname,
      'kind', t.typtype,
      'category', t.typcategory,
      'owner', pg_get_userbyid(t.typowner),
      'base_type', CASE WHEN t.typbasetype=0 THEN NULL ELSE format_type(t.typbasetype,t.typtypmod) END,
      'element_type', CASE WHEN t.typelem=0 THEN NULL ELSE format_type(t.typelem,NULL) END,
      'not_null', t.typnotnull,
      'acl', t.typacl::text,
      'enum_labels', coalesce((
        SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
        FROM pg_catalog.pg_enum e WHERE e.enumtypid=t.oid
      ), '[]'::jsonb)
    ) ORDER BY n.nspname,t.typname)
    FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname !~ '^pg_(catalog|toast)'
      AND n.nspname <> 'information_schema'
      AND t.typtype IN ('b','c','d','e','r')
      AND t.typname NOT LIKE '\_%' ESCAPE '\'
  ), '[]'::jsonb),
  'routines', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'schema', n.nspname,
      'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'kind', p.prokind,
      'owner', pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef,
      'volatility', p.provolatile,
      'configuration', p.proconfig,
      'acl', p.proacl::text,
      'definition_md5', md5(pg_get_functiondef(p.oid))
    ) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid))
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname !~ '^pg_(catalog|toast)'
      AND n.nspname <> 'information_schema'
      AND p.prokind IN ('f','p')
  ), '[]'::jsonb),
  'roles', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'name', r.rolname,
      'superuser', r.rolsuper,
      'create_role', r.rolcreaterole,
      'create_db', r.rolcreatedb,
      'login', r.rolcanlogin,
      'replication', r.rolreplication,
      'bypass_rls', r.rolbypassrls,
      'inherit', r.rolinherit
    ) ORDER BY r.rolname)
    FROM pg_catalog.pg_roles r
  ), '[]'::jsonb),
  'role_memberships', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'role', role.rolname,
      'member', member.rolname,
      'grantor', grantor.rolname,
      'admin_option', m.admin_option
    ) ORDER BY role.rolname,member.rolname)
    FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles role ON role.oid=m.roleid
    JOIN pg_catalog.pg_roles member ON member.oid=m.member
    JOIN pg_catalog.pg_roles grantor ON grantor.oid=m.grantor
  ), '[]'::jsonb),
  'default_privileges', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'owner', pg_get_userbyid(d.defaclrole),
      'schema', coalesce(n.nspname,''),
      'object_type', d.defaclobjtype,
      'acl', d.defaclacl::text
    ) ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype)
    FROM pg_catalog.pg_default_acl d
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
  ), '[]'::jsonb),
  'migration_ledger', jsonb_build_object(
    'exists', pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
  )
))::text AS catalog_snapshot;

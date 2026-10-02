-- Privileges for the two migrated read routes only. This role cannot log in;
-- attach a separate staging-only LOGIN role with a secret kept out of Git.
create role al_edge_catalog_reader nologin;

grant connect on database postgres to al_edge_catalog_reader;
grant usage on schema public to al_edge_catalog_reader;

grant select (id, user_id, jwt_id, revoked_at, expires_at)
  on table public.sessions to al_edge_catalog_reader;
grant select (
  id, google_sub, email_verified_at, email_verification_required,
  email_verification_legacy_exempt, deleted_at
) on table public.users to al_edge_catalog_reader;

-- No table-level SELECT, sequence, function, write, schema CREATE, or
-- application-table grants to anon/authenticated are introduced here.

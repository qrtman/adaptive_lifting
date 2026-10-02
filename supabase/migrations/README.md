# Migration baseline

The foundation milestone added no SQL migration. The Python Alembic revision
`0011_email_verification` is the existing schema baseline for `users` and
`sessions`. The Edge function reads those tables only. It creates no tables,
grants, RLS policies, triggers, or functions.

For a future Supabase project, load and verify the existing application schema
before routing requests to the Edge function. Keep browser roles (`anon` and
`authenticated`) without application-table grants. Use a dedicated server-only
database credential with `SELECT` limited to the columns queried here when
provisioning the environment. Do not use that credential in the frontend.

Any later coexistence migration must be additive and keep Python compatible.

`20261002071547_edge_catalog_reader.sql` is the next additive migration. It
creates only a NOLOGIN privilege group and grants CONNECT, schema USAGE, and
column-level SELECT needed by the session validator. It does not change table
structure, Python behavior, browser grants, or Data API exposure. A separate
staging-only LOGIN role and password must be provisioned operationally, then
tested before the function receives its connection URL. See
`../STAGING_VALIDATION.md`. This migration has not been applied by this branch.

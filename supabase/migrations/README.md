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

`20261002090404_edge_catalog_reader.sql` creates the NOLOGIN privilege group
and grants CONNECT, schema USAGE, and column-level SELECT needed by the session
validator. `20261002092347_al_edge_catalog_runtime.sql` creates a separate
staging runtime LOGIN that inherits only that group; its password is provisioned
operationally and is not stored in this repository. Neither migration changes
table structure, Python behavior, browser grants, or Data API exposure. Both
were applied only to staging and their filenames were reconciled with the
recorded Supabase migration versions. See `../STAGING_VALIDATION.md`.

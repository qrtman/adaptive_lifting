# Migration baseline

This milestone adds no SQL migration. The Python Alembic revision
`0011_email_verification` is the existing schema baseline for `users` and
`sessions`. The Edge function reads those tables only. It creates no tables,
grants, RLS policies, triggers, or functions.

For a future Supabase project, load and verify the existing application schema
before routing requests to the Edge function. Keep browser roles (`anon` and
`authenticated`) without application-table grants. Use a dedicated server-only
database credential with `SELECT` limited to the columns queried here when
provisioning the environment. Do not use that credential in the frontend.

Any later coexistence migration must be additive and keep Python compatible.

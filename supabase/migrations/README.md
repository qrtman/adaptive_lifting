# Migration baseline

The foundation milestone added no SQL migration. The timestamped Supabase SQL
history is not a clean-database bootstrap: it assumes the application schema
from the legacy Alembic history (`0001_current_schema` through
`0011_email_verification`) is already installed. Revision `0011` is the
email-verification change, not a schema baseline by itself. The current Edge
API uses the resulting application tables plus later SQL private interfaces.

For a new Supabase project, first produce and review a deterministic SQL
bootstrap from the complete Alembic schema history (or an equivalent audited
schema snapshot), validate it against an empty disposable PostgreSQL target,
then apply the timestamped Supabase SQL deltas in a clean replay. Do not apply
the deltas alone to an empty project. Keep browser roles (`anon` and
`authenticated`) without application-table grants. Use a dedicated server-only
database credential with `SELECT` limited to the columns queried here when
provisioning the environment. Do not use that credential in the frontend.

Python is not an application runtime dependency; these Alembic files are
schema and data-migration history only. See `../PRODUCTION_CUTOVER.md` and
`../PRODUCTION_READINESS_AUDIT.md` for future production gates.

`20261002090404_edge_catalog_reader.sql` creates the NOLOGIN privilege group
and grants CONNECT, schema USAGE, and column-level SELECT needed by the session
validator. `20261002092347_al_edge_catalog_runtime.sql` creates a separate
staging runtime LOGIN that inherits only that group; its password is provisioned
operationally and is not stored in this repository. Neither migration changes
table structure, Python behavior, browser grants, or Data API exposure. Both
were applied only to staging and their filenames were reconciled with the
recorded Supabase migration versions. See `../STAGING_VALIDATION.md`.

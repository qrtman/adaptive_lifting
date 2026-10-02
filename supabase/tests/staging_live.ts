// Manual, staging-only integration probe. Never runs as part of local unit tests.
// Requires an independently confirmed adaptive-lifting-staging project ref and
// staging-only admin/runtime connection URLs supplied through secure env vars.
import { SignJWT } from "jose";
import { authenticate } from "../functions/_shared/auth/session.ts";
import {
  authRepository,
  checkDatabase,
  type Database,
  databaseFromUrl,
} from "../functions/_shared/db/mod.ts";
import { ApiError } from "../functions/_shared/errors/mod.ts";
import type { AppConfig } from "../functions/_shared/config.ts";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(`FAILED: ${label}`);
  console.log(`PASS: ${label}`);
}
function sameProject(url: string, ref: string): boolean {
  const parsed = new URL(url);
  return parsed.hostname === `db.${ref}.supabase.co` ||
    (/\.pooler\.supabase\.com$/.test(parsed.hostname) &&
      parsed.username.endsWith(`.${ref}`));
}
async function sql<T>(
  db: Database,
  query: string,
  args: unknown[] = [],
): Promise<T[]> {
  const client = await db.connect();
  try {
    return (await client.queryObject<T>(query, args)).rows;
  } finally {
    client.release();
  }
}

const ref = required("STAGING_PROJECT_REF");
if (
  required("STAGING_PROJECT_NAME") !== "adaptive-lifting-staging" ||
  !/^[a-z0-9]{20}$/.test(ref)
) {
  throw new Error("Confirm the exact staging project name and ref first");
}
const adminUrl = required("STAGING_ADMIN_DATABASE_URL");
const runtimeUrl = required("STAGING_RUNTIME_DATABASE_URL");
if (!sameProject(adminUrl, ref) || !sameProject(runtimeUrl, ref)) {
  throw new Error("Both database URLs must point to the confirmed staging ref");
}
const admin = databaseFromUrl(adminUrl);
const runtime = databaseFromUrl(runtimeUrl);
const config: AppConfig = {
  databaseUrl: runtimeUrl,
  jwtCurrent: required("JWT_SECRET_CURRENT"),
  jwtPrevious: Deno.env.get("JWT_SECRET_PREVIOUS") || null,
  enforceLegacyEmailVerification: false,
  allowedOrigins: ["https://staging.example.invalid"],
};

const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
const [eligible, google, pending, deleted, other] = ids;
const sessions = Array.from({ length: 7 }, () => crypto.randomUUID());
async function token(userId: string, sessionId: string): Promise<string> {
  return await new SignJWT({ session_id: sessionId })
    .setProtectedHeader({ alg: "HS256", kid: "current" })
    .setSubject(userId).setExpirationTime("5m")
    .sign(new TextEncoder().encode(config.jwtCurrent));
}
async function status(userId: string, sessionId: string): Promise<number> {
  const request = new Request(
    "https://staging.example.invalid/api/analytics/catalog",
    {
      headers: { Cookie: `session_id=${await token(userId, sessionId)}` },
    },
  );
  try {
    await authenticate(request, authRepository(runtime), config);
    return 200;
  } catch (error) {
    if (error instanceof ApiError) return error.status;
    throw error;
  }
}
async function denied(query: string, args: unknown[] = []): Promise<boolean> {
  const client = await runtime.connect();
  try {
    await client.queryObject("begin");
    await client.queryObject("savepoint probe");
    try {
      await client.queryObject(query, args);
      return false;
    } catch (error) {
      return /42501|permission denied|not permitted|must be owner/i.test(
        String(error),
      );
    } finally {
      await client.queryObject("rollback");
    }
  } finally {
    client.release();
  }
}

try {
  const identity = await sql<
    { current_database: string; current_user: string }
  >(
    runtime,
    "select current_database(), current_user",
  );
  assert(
    identity[0]?.current_database === "postgres",
    "restricted pooler database connection",
  );
  assert(identity[0]?.current_user !== "postgres", "runtime is not owner role");
  await checkDatabase(runtime);
  assert(
    (await sql<{ ok: number }>(runtime, "select 1 as ok"))[0]?.ok === 1,
    "SELECT 1",
  );
  const privileges = await sql<{ table_name: string; column_name: string }>(
    runtime,
    `select c.relname as table_name, a.attname as column_name
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r','p')
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
       and has_column_privilege(current_user, c.oid, a.attname, 'SELECT')
     order by c.relname, a.attname`,
  );
  const actual = privileges.map((row) =>
    `${row.table_name}.${row.column_name}`
  );
  const expected = [
    "sessions.expires_at",
    "sessions.id",
    "sessions.jwt_id",
    "sessions.revoked_at",
    "sessions.user_id",
    "users.deleted_at",
    "users.email_verification_legacy_exempt",
    "users.email_verification_required",
    "users.email_verified_at",
    "users.google_sub",
    "users.id",
  ];
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    "runtime has exactly eleven public-column SELECT privileges",
  );
  const scope = await sql<
    {
      connect: boolean;
      schema_usage: boolean;
      schema_create: boolean;
      owned_tables: number;
      usable_sequences: number;
    }
  >(
    runtime,
    `select has_database_privilege(current_user, current_database(), 'CONNECT') as connect,
       has_schema_privilege(current_user, 'public', 'USAGE') as schema_usage,
       has_schema_privilege(current_user, 'public', 'CREATE') as schema_create,
       (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r','p') and c.relowner = current_user::regrole) as owned_tables,
       (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'S'
          and has_sequence_privilege(current_user, c.oid, 'USAGE')) as usable_sequences`,
  );
  assert(
    !!scope[0]?.connect && !!scope[0]?.schema_usage &&
      !scope[0]?.schema_create &&
      scope[0]?.owned_tables === 0 && scope[0]?.usable_sequences === 0,
    "runtime has CONNECT and public USAGE, no CREATE, ownership or sequence USAGE",
  );

  for (const [index, id] of ids.entries()) {
    await sql(
      admin,
      `insert into public.users
       (id, email, hashed_password, role, google_sub, email_verified_at,
        email_verification_required, email_verification_legacy_exempt, deleted_at)
       values ($1, $2, $3, 'ATHLETE', $4, $5, true, false, $6)`,
      [
        id,
        `supabase-staging-probe-${id}@example.invalid`,
        "!staging-probe-no-login!",
        index === 1 ? `google-probe-${id}` : null,
        index === 0 || index === 4 ? new Date() : null,
        index === 3 ? new Date() : null,
      ],
    );
  }
  for (const [index, id] of sessions.entries()) {
    const owner =
      [eligible, google, pending, deleted, eligible, eligible, other][index];
    await sql(
      admin,
      `insert into public.sessions (id, user_id, jwt_id, expires_at, revoked_at)
       values ($1, $2, $1, $3, $4)`,
      [
        id,
        owner,
        index === 5
          ? new Date(Date.now() - 60_000)
          : new Date(Date.now() + 600_000),
        index === 4 ? new Date() : null,
      ],
    );
  }

  assert(
    (await sql(runtime, "select id from public.users where id = $1", [
      eligible,
    ])).length === 1,
    "users lookup",
  );
  assert(
    (await sql(runtime, "select id from public.sessions where id = $1", [
      sessions[0],
    ])).length === 1,
    "sessions lookup",
  );
  assert(
    await status(eligible, sessions[0]) === 200,
    "eligible password account",
  );
  assert(
    await status(google, sessions[1]) === 200,
    "eligible Google-linked account",
  );
  assert(
    await status(pending, sessions[2]) === 403,
    "email verification required",
  );
  assert(await status(deleted, sessions[3]) === 401, "deleted user rejected");
  assert(
    await status(eligible, sessions[4]) === 401,
    "revoked session rejected",
  );
  assert(
    await status(eligible, sessions[5]) === 401,
    "expired DB session rejected",
  );
  assert(
    await status(eligible, sessions[6]) === 401,
    "user/session mismatch rejected",
  );
  assert(
    await status(eligible, crypto.randomUUID()) === 401,
    "missing session rejected",
  );

  assert(
    await denied("update public.users set id = id where false"),
    "runtime cannot modify users",
  );
  assert(
    await denied("update public.sessions set id = id where false"),
    "runtime cannot modify sessions",
  );
  assert(
    await denied("insert into public.users (id) select $1 where false", [
      crypto.randomUUID(),
    ]),
    "runtime cannot insert users",
  );
  assert(
    await denied("insert into public.sessions (id) select $1 where false", [
      crypto.randomUUID(),
    ]),
    "runtime cannot insert sessions",
  );
  assert(
    await denied("delete from public.users where false"),
    "runtime cannot delete users",
  );
  assert(
    await denied("delete from public.sessions where false"),
    "runtime cannot delete sessions",
  );
  assert(
    await denied(
      "select token_hash from public.email_verification_tokens limit 0",
    ),
    "runtime cannot read verification tokens",
  );
  assert(
    await denied("select * from public.integration_credentials limit 0"),
    "runtime cannot read integration credentials",
  );
  assert(
    await denied(
      "create table public.al_runtime_probe_should_not_exist (id int)",
    ),
    "runtime cannot create schema objects",
  );
  assert(
    await denied("set role postgres"),
    "runtime cannot escalate to postgres",
  );

  const browser = await sql<
    { role: string; readable_columns: number; writable_tables: number }
  >(
    admin,
    `
    select r.rolname as role,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
       where n.nspname = 'public' and c.relkind in ('r','p')
         and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
         and has_column_privilege(r.rolname, c.oid, a.attname, 'SELECT')) as readable_columns,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r','p')
         and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
         and has_table_privilege(r.rolname, c.oid, 'INSERT,UPDATE,DELETE')) as writable_tables
    from pg_roles r where r.rolname in ('anon', 'authenticated') order by r.rolname`,
  );
  assert(
    browser.length === 2 &&
      browser.every((row) =>
        row.readable_columns === 0 && row.writable_tables === 0
      ),
    "anon and authenticated retain zero public-table read/write privilege",
  );
} finally {
  for (const id of sessions) {
    await sql(admin, "delete from public.sessions where id = $1", [id]);
  }
  for (const id of ids) {
    await sql(admin, "delete from public.users where id = $1", [id]);
  }
  console.log("CLEANUP: synthetic sessions and users deleted");
}

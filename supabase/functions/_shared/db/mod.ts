import { Pool } from "@db/postgres";
import type { AppUser, AuthRepository, AuthSession } from "../types/mod.ts";

export interface SqlClient {
  queryObject<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }>;
  release(): void;
}

export interface Database {
  connect(): Promise<SqlClient>;
}

export function databaseFromUrl(url: string): Database {
  // A single connection per warm isolate bounds Edge Function concurrency.
  // Enforce TLS for remote hosts; the local Supabase CLI database is the
  // only plain-text exception. Never expose this credential to browsers.
  const parsed = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  const pool = new Pool(
    {
      hostname: parsed.hostname,
      port: Number(parsed.port || 5432),
      database: decodeURIComponent(parsed.pathname.slice(1)),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      tls: { enabled: !local, enforce: !local },
    },
    1,
    true,
  );
  return pool;
}

async function readOne<T>(
  db: Database,
  query: string,
  parameters: unknown[],
): Promise<T | null> {
  const client = await db.connect();
  try {
    const result = await client.queryObject<T>(query, parameters);
    return result.rows[0] ?? null;
  } finally {
    client.release();
  }
}

export function authRepository(db: Database): AuthRepository {
  return {
    findSession: (id) =>
      readOne<AuthSession>(
        db,
        `
      select id, user_id, jwt_id, revoked_at, expires_at,
        (expires_at > (now() at time zone 'utc')) as active
      from public.sessions where id = $1
    `,
        [id],
      ),
    findUser: (id) =>
      readOne<AppUser>(
        db,
        `
      select id, email, role, display_name, google_sub, email_verified_at,
        email_verification_required, email_verification_legacy_exempt, deleted_at
      from public.users where id = $1
    `,
        [id],
      ),
  };
}

export async function checkDatabase(db: Database): Promise<void> {
  await readOne(db, "select 1 as ok", []);
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationDir = new URL('../../supabase/migrations/', import.meta.url);
const sql = readFileSync(new URL('20261108130000_auth_login_account_limit.sql', migrationDir), 'utf8');
const body = sql.slice(sql.indexOf('create or replace function al_private.al_auth_login'), sql.indexOf('$function$;'));

describe('per-account login limit migration contract', () => {
  it('creates a private hashed-subject counter table with no runtime table grants', () => {
    expect(sql).toMatch(/create table if not exists public\.auth_login_failures \(\s*subject_hash text primary key check \(subject_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
    expect(sql).toContain('alter table public.auth_login_failures enable row level security;');
    expect(sql).toMatch(/revoke all on public\.auth_login_failures\s+from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;/);
    expect(sql).not.toMatch(/grant [^;]* on public\.auth_login_failures/i);
    expect(sql).not.toMatch(/\bemail\s+(?:text|varchar)/i);
  });

  it('keeps the address bucket and adds a 10-failure / 15-minute account bucket', () => {
    expect(body).toContain("created_at <= v_now - interval '60 seconds'");
    expect(body).toContain('if v_count >= 20 then');
    expect(body).toContain("extensions.digest('auth:login:email:' || v_email, 'sha256')");
    expect(body).toContain('v_email := pg_catalog.lower(pg_catalog.btrim(p_email));');
    expect(body).toContain("v_window <= v_now - interval '15 minutes'");
    expect(body).toContain('if v_failures >= 10 then');
    expect(body).toMatch(/where subject_hash = v_email_hash for update/);
    // The account bucket denies with the same generic denial as the address bucket.
    const denials = [...body.matchAll(/'denial', '([a-z_]+)'/g)].map((match) => match[1]);
    expect(new Set(denials)).toEqual(new Set(['invalid_request', 'rate_limited', 'invalid_credentials', 'account_ineligible']));
  });

  it('runs a dummy bcrypt compare for accounts without a usable password hash', () => {
    expect(body).toContain("perform extensions.crypt(p_password, extensions.gen_salt('bf', 12));");
    expect(body.indexOf('gen_salt')).toBeGreaterThan(body.indexOf('v_user_found := found;'));
    // Unknown and wrong-password paths share one failure branch and response.
    expect(body.match(/'denial', 'invalid_credentials'/g)).toHaveLength(1);
  });

  it('audits LOGIN_FAILED with hashes only and no raw email or unauthenticated actor', () => {
    const audit = body.slice(body.indexOf('insert into public.audit_events'), body.indexOf("return pg_catalog.jsonb_build_object('denial', 'invalid_credentials')"));
    expect(audit).toContain("'LOGIN_FAILED', 'AuthLogin', v_email_hash");
    expect(audit).toContain("'email_hash', v_email_hash");
    expect(audit).toMatch(/values \(extensions\.gen_random_uuid\(\)::text, null,/);
    expect(audit).not.toMatch(/p_email|v_email[^_]|v_user\.email/);
  });

  it('clears the account window on a correct password and preserves the RPC signature and grants', () => {
    expect(body).toContain('delete from public.auth_login_failures where subject_hash = v_email_hash;');
    expect(sql).toContain('revoke all on function al_private.al_auth_login(text,text,text,text,boolean) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function al_private.al_auth_login(text,text,text,text,boolean) to al_edge_catalog_runtime;');
  });
});

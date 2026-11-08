import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL('../../supabase/migrations/20261108140000_coach_code_link_hardening.sql', import.meta.url),
  'utf8',
);
const route = readFileSync(new URL('../../supabase/functions/_shared/accountSecurityRoute.ts', import.meta.url), 'utf8');

function body(name: string): string {
  const start = sql.indexOf(`create or replace function al_private.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('$function$;', start));
}

describe('coach code link hardening migration', () => {
  it('keys new codes with a database-held HMAC and issues 15-minute codes', () => {
    expect(sql).toContain("vault.create_secret(pg_catalog.encode(extensions.gen_random_bytes(32),'hex'), 'adaptive_lifting_coach_code_hmac_key')");
    expect(body('al_coach_code_hmac')).toContain('extensions.hmac(');
    const issue = body('al_coach_code_issue');
    expect(issue).toContain("interval '15 minutes'");
    expect(issue).not.toContain('365 days');
    expect(issue).toContain("p_code !~ '^[A-HJ-NP-Z2-9]{10}$'");
    expect(sql).toMatch(/revoke all on function al_private\.al_coach_code_hmac\(text\)\s+from public, anon, authenticated, al_edge_catalog_runtime/);
  });

  it('rate limits per account and IP, then checks athlete state, before looking up the code', () => {
    const link = body('al_athlete_link_code');
    const rate = link.indexOf("'coach-link:user:minute:'");
    const linked = link.indexOf("'already_linked'");
    const lookup = link.indexOf('where code_hash=v_code_hash');
    expect(rate).toBeGreaterThan(0);
    expect(link).toContain("'coach-link:user:hour:'||v_athlete.id,'sha256'),'hex'),20,3600)");
    expect(link).toContain("'coach-link:ip:minute:'||p_ip_subject_hash,'sha256'),'hex'),5,60)");
    expect(link).toContain("'coach-link:ip:hour:'||p_ip_subject_hash,'sha256'),'hex'),20,3600)");
    expect(linked).toBeGreaterThan(rate);
    expect(lookup).toBeGreaterThan(linked);
  });

  it('returns only the generic denial after the lookup and never the coach email', () => {
    const link = body('al_athlete_link_code');
    const afterLookup = link.slice(link.indexOf('where code_hash=v_code_hash'));
    const denials = [...afterLookup.matchAll(/'denial','([a-z_]+)'/g)].map((match) => match[1]);
    expect(new Set(denials)).toEqual(new Set(['invalid_code']));
    expect(link).not.toContain('v_coach.email||');
    expect(link).not.toContain('v_coach.email)');
    expect(link).toContain("'message','Linked to your coach.'");
  });

  it('keeps legacy codes redeemable until expiry and retires old runtime entry points', () => {
    expect(body('al_athlete_link_code')).toContain("elsif v_code ~ '^[0-9A-F]{6}$'");
    expect(sql).toContain('revoke execute on function al_private.al_coach_code_create(text,text,text,text,boolean,integer) from al_edge_catalog_runtime');
    expect(sql).toContain('revoke execute on function al_private.al_athlete_link(text,text,text,boolean,integer) from al_edge_catalog_runtime');
    expect(route).toContain('al_private.al_athlete_link_code(');
    expect(route).toContain('al_private.al_coach_code_issue(');
    expect(route).not.toContain('al_private.al_athlete_link(');
    expect(route).not.toContain('al_private.al_coach_code_create(');
  });
});

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { fernetEncrypt } from '../../supabase/functions/_shared/fernet.ts';
import { tryProcessEmailVerificationJob } from '../../supabase/functions/_shared/emailWorkerCore.ts';
import type { Database, SqlClient } from '../../supabase/functions/_shared/db/mod.ts';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));

function encodedKey(): string {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  return Buffer.from(bytes).toString('base64url');
}

function mockDatabase(encryptedPayload: string) {
  let claimed = false;
  const finishes: unknown[][] = [];
  const answer = <T>(payload: unknown): { rows: T[] } => ({ rows: [{ payload } as T] });
  const client: SqlClient = {
    async queryObject<T>(query: string, args: unknown[] = []) {
      if (query.includes('al_email_worker_claim')) {
        if (claimed) return { rows: [] };
        claimed = true;
        return answer<T>({ jobId: 'job-1', claimToken: args[0] });
      }
      if (query.includes('al_email_worker_begin')) {
        return answer<T>({ send: true, userId: 'user-1', email: 'athlete@example.invalid', encryptedPayload });
      }
      if (query.includes('al_email_worker_finish')) {
        finishes.push(args);
        return answer<T>({ updated: true });
      }
      if (query.includes('al_email_worker_unlock')) return answer<T>(true);
      throw new Error('Unexpected worker RPC');
    },
    release() {},
  };
  const db: Database = { async connect() { return client; } };
  return { db, finishes, get claimed() { return claimed; } };
}

const config = (key: string, fetcher: typeof fetch) => ({
  payloadKey: key,
  emailApiKey: 'resend-test-key',
  emailFrom: 'Adaptive Lifting <verify@example.invalid>',
  appUrl: 'https://app.example.invalid',
  enforceLegacy: false,
  fetcher,
});

describe('email-verification Edge worker', () => {
  it('claims once and delivers the fragment URL with the outbox idempotency key', async () => {
    const key = encodedKey();
    const rawToken = 'a'.repeat(43);
    const payload = await fernetEncrypt(rawToken, key);
    const state = mockDatabase(payload);
    const sends: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sends.push(init ?? {});
      return new Response('', { status: 202 });
    });
    const result = await Promise.all([
      tryProcessEmailVerificationJob(state.db, config(key, fetcher)),
      tryProcessEmailVerificationJob(state.db, config(key, fetcher)),
    ]);
    expect(result.sort()).toEqual(['accepted', 'empty']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sends[0].headers).toMatchObject({ 'idempotency-key': 'job-1' });
    const message = JSON.parse(String(sends[0].body));
    expect(message.to).toEqual(['athlete@example.invalid']);
    expect(message.text).toContain(`/verify-email#token=${rawToken}`);
    expect(message.text).not.toContain('?token=');
    expect(state.finishes).toHaveLength(1);
    expect(state.finishes[0][3]).toBe('success');
  });

  it.each([
    [429, 'temporary'],
    [503, 'temporary'],
    [408, 'temporary'],
    [400, 'permanent'],
  ])('classifies provider status %s without persisting response content', async (status, outcome) => {
    const key = encodedKey();
    const payload = await fernetEncrypt('b'.repeat(43), key);
    const state = mockDatabase(payload);
    const result = await tryProcessEmailVerificationJob(state.db, config(key, async () => new Response('sensitive-provider-body', { status })));
    expect(result).toBe('deferred');
    expect(state.finishes[0][3]).toBe(outcome);
  });

  it('permanently rejects an unreadable encrypted payload without calling Resend', async () => {
    const state = mockDatabase('corrupt');
    const fetcher = vi.fn();
    await tryProcessEmailVerificationJob(state.db, config(encodedKey(), fetcher));
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.finishes[0][3]).toBe('permanent');
  });
});

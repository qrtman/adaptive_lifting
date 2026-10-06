import { describe, expect, it } from 'vitest';
import { coexistenceProxy } from '../../deploy/coexistenceProxy';

const paths = [
  '/api/billing/plans',
  '/api/billing/stripe/checkout-session',
  '/api/billing/stripe/portal-session',
  '/api/billing/stripe/webhook',
  '/api/billing/vouchers/redeem',
];

describe('billing coexistence routing', () => {
  it('routes only the five billing capabilities to the API Edge Function', () => {
    const routes = coexistenceProxy('https://legacy.example.test', 'https://project.supabase.co');
    for (const path of paths) {
      const key = Object.keys(routes).find((candidate) => candidate.startsWith('^') && new RegExp(candidate).test(path));
      expect(key).toBeDefined();
      const rewrite = routes[key!].rewrite;
      expect(typeof rewrite).toBe('function');
      expect(rewrite!(path)).toBe(`/functions/v1/api${path.slice('/api'.length)}`);
    }
    expect(routes['/api'].target).toBe('https://legacy.example.test');
    expect(Object.keys(routes).filter((key) => key.startsWith('^') && new RegExp(key).test('/api/billing/internal'))).toEqual([]);
  });
});

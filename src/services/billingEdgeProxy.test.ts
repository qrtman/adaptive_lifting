import { describe, expect, it } from 'vitest';
import { edgeOnlyProxy } from '../../deploy/edgeOnlyProxy';

describe('billing routes share the Edge-only API proxy', () => {
  it('uses one proxy for all API paths with the standard Edge function rewrite', () => {
    const routes = edgeOnlyProxy('https://project.supabase.co');
    expect(Object.keys(routes)).toEqual(['/api']);
    expect(routes['/api'].target).toBe('https://project.supabase.co');
    expect(routes['/api'].rewrite?.('/api/billing/stripe/webhook?event=1'))
      .toBe('/functions/v1/api/billing/stripe/webhook?event=1');
  });
});

import { describe, expect, it } from 'vitest';
import { verifyOfflineGrant } from './authAuthorization';

const grant = process.env.STAGING_OFFLINE_GRANT;
const publicKey = process.env.STAGING_OFFLINE_PUBLIC_KEY;

describe.skipIf(!grant || !publicKey)('live staging offline grant', () => {
  it('passes the production frontend ES256 verifier', async () => {
    const verified = await verifyOfflineGrant(grant!, publicKey!);
    expect(verified).not.toBeNull();
    expect(verified?.user.role).toBe('ATHLETE');
    expect(verified?.scopes).toContain(verified?.user.id);
  });
});

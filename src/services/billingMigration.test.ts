import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationDir = new URL('../../supabase/migrations/', import.meta.url);
const billingSql = readFileSync(new URL('20261007150000_billing_domain.sql', migrationDir), 'utf8');
const secretIsolationSql = readFileSync(new URL('20261009100000_voucher_secret_independence.sql', migrationDir), 'utf8');
const operatorSql = readFileSync(new URL('20261009101000_billing_operator_voucher_by_id.sql', migrationDir), 'utf8');
const checkoutConcurrencySql = readFileSync(new URL('20261009102000_billing_checkout_finalize_concurrency.sql', migrationDir), 'utf8');
const webhookValidationSql = readFileSync(new URL('20261009103000_stripe_webhook_shape_validation.sql', migrationDir), 'utf8');
const voucherSql = readFileSync(new URL('20261007153000_voucher_claim_rollback.sql', migrationDir), 'utf8');
const checkoutSchema = readFileSync(new URL('../../backend/migrations/versions/0008_checkout_reservation.py', import.meta.url), 'utf8');

describe('Supabase billing migration contract', () => {
  it('uses existing billing/access tables without creating replacements', () => {
    expect(billingSql).not.toMatch(/create\s+table\s+(?:public\.)?(?:workspaces|workspace_members|access_grants|subscriptions|billing_customers|billing_checkout_reservations|vouchers|voucher_redemption_limits|webhook_events|audit_events)/i);
    expect(billingSql).toContain('al_private.al_billing_owner');
    expect(billingSql).toContain("v_ctx->>'role'<>'COACH'");
    expect(billingSql).toContain("v_member.role<>'OWNER'");
  });

  it('serializes checkout, protects the 23-hour replay window, and keeps provider idempotency inputs', () => {
    expect(billingSql).toContain('for update');
    expect(billingSql).toContain("v_now-v_row.created_at>interval '23 hours'");
    expect(billingSql).toContain("v_now-v_row.updated_at<interval '10 minutes'");
    expect(checkoutSchema).toContain('sa.UniqueConstraint("workspace_id", "provider"');
    expect(checkoutSchema).toContain('sa.UniqueConstraint("provider", "request_id"');
    expect(checkoutConcurrencySql).toContain("v_row.status = 'COMPLETED'");
    expect(checkoutConcurrencySql).toContain("'resumed', true");
    expect(checkoutConcurrencySql).toContain("[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
  });

  it('uses trusted customer and event identities with ordered webhook transitions', () => {
    expect(billingSql).toContain("where provider='stripe' and provider_customer_id=v_customer_id");
    expect(billingSql).toContain("where provider='stripe' and provider_subscription_id=v_sub_id");
    expect(billingSql).toContain('(v_event_time,v_event_id)<=');
    expect(billingSql).toContain("set status='FAILED',processed_at=v_now");
    expect(billingSql).toContain("v_status not in ('CANCELED','EXPIRED')");
    expect(webhookValidationSql).toContain("jsonb_typeof(v_obj->'current_period_start') not in ('number', 'null')");
    expect(webhookValidationSql).toContain("convert_to(v_event_id, 'UTF8')");
    expect(webhookValidationSql).toContain("p_event ? 'account'");
  });

  it('limits voucher database access, stacks same-plan grants, and stores only HMACs', () => {
    expect(billingSql).toContain("encode(extensions.hmac(v_code,v_secret,'sha256'),'hex')");
    expect(billingSql).toContain("v_start:=coalesce(v_latest.expires_at,v_now)");
    expect(voucherSql).toContain('select * into v_workspace from public.workspaces where owner_user_id=p_actor for update');
    expect(billingSql).toContain('public.voucher_redemption_limits(subject_hash');
    expect(billingSql).toContain('from public,anon,authenticated,al_edge_catalog_runtime,al_edge_catalog_reader');
    expect(secretIsolationSql).toContain("d.name = p_name");
    expect(secretIsolationSql).toContain('adaptive_lifting_offline_auth_private_key');
  });

  it('removes plaintext voucher inspect/revoke calls and retains operator-only ID procedures', () => {
    expect(operatorSql).toContain('drop function if exists al_private.al_billing_operator_inspect_voucher(text)');
    expect(operatorSql).toContain('drop function if exists al_private.al_billing_operator_revoke_voucher(text)');
    expect(operatorSql).toContain('al_billing_operator_inspect_voucher_by_id');
    expect(operatorSql).toContain('al_billing_operator_revoke_voucher_by_id');
    expect(operatorSql).toContain('from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader');
    expect(operatorSql).not.toContain('code_hash');
  });
});

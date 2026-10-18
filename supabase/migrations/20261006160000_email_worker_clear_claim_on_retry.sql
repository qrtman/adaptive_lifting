-- Keep leases explicit after a worker has finalized a retryable provider error.
create or replace function al_private.al_email_worker_finish(
  p_job_id text,p_claim_token text,p_user_id text,p_outcome text
) returns jsonb language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_attempt integer;
  v_updated integer := 0;
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.clock_timestamp());
begin
  if p_outcome not in ('success','temporary','permanent') then
    perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('email-verification-user:' || coalesce(p_user_id,''),0));
    return pg_catalog.jsonb_build_object('updated',false);
  end if;
  select o.attempt_count into v_attempt from public.integration_outbox o
    where o.id=p_job_id and o.provider='email-verification' and o.status='processing'
      and o.claim_token=p_claim_token for update;
  if found then
    if p_outcome='success' then
      update public.integration_outbox set status='success',retry_after=null,encrypted_payload=null,
        claim_token=null,result='Verification email accepted' where id=p_job_id and claim_token=p_claim_token;
    elsif p_outcome='temporary' and v_attempt<3 then
      update public.integration_outbox set status='failed',retry_after=v_now+pg_catalog.make_interval(mins => 5*v_attempt),
        claim_token=null,result='Email provider temporarily unavailable' where id=p_job_id and claim_token=p_claim_token;
    else
      update public.integration_outbox set status='failed',attempt_count=3,retry_after=null,encrypted_payload=null,
        claim_token=null,result='Email provider rejected delivery' where id=p_job_id and claim_token=p_claim_token;
    end if;
    get diagnostics v_updated = row_count;
  end if;
  perform pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('email-verification-user:' || coalesce(p_user_id,''),0));
  return pg_catalog.jsonb_build_object('updated',v_updated=1);
end;
$function$;

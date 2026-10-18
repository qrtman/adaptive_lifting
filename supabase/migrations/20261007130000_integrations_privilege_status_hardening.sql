-- Integration data is accessed only through the audited private SECURITY DEFINER RPCs.
-- Supabase browser roles and Edge runtime roles must not get generic table access.
revoke all on public.integration_connections, public.integration_credentials,
  public.integration_outbox, public.webhook_events, public.oauth_states,
  public.telegram_link_tokens
  from public, anon, authenticated, al_edge_catalog_runtime, al_edge_catalog_reader;

-- Expose a successful publication URL separately from a failure message so the
-- existing panel can provide an Open Sheet link without overloading `error`.
create or replace function al_private.al_sheets_status(
  p_actor text,p_session text,p_enforce_legacy boolean
) returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_conn public.integration_connections%rowtype; v_jobs jsonb;
begin
  v_ctx:=al_private.al_integration_actor(p_actor,p_session,p_enforce_legacy);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  select * into v_conn from public.integration_connections
   where user_id=p_actor and provider='google-sheets' and status='active' and deleted_at is null limit 1;
  if not found then return pg_catalog.jsonb_build_object('denial',null,'status','disconnected'); end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',j.id,
    'sheet_name',coalesce(j.payload_json::jsonb->>'sheet_name','Untitled Publish'),
    'status',j.status,
    'attempts',coalesce(j.attempt_count,0),
    'error',case when j.status='failed' then j.result else null end,
    'result',case when j.status='success' then j.result else null end
  ) order by j.id desc),'[]'::jsonb) into v_jobs
    from (select * from public.integration_outbox where provider='google-sheets'
      and connection_id=v_conn.id order by id desc limit 5) j;
  return pg_catalog.jsonb_build_object('denial',null,'status','connected',
    'connection_id',v_conn.id,'jobs',v_jobs);
end;
$function$;
revoke all on function al_private.al_sheets_status(text,text,boolean)
  from public,anon,authenticated,al_edge_catalog_reader;
grant execute on function al_private.al_sheets_status(text,text,boolean)
  to al_edge_catalog_runtime;

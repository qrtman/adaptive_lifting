create or replace function al_private.al_voucher_redeem(p_actor text,p_session text,p_enforce boolean,p_hash text)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare v_ctx jsonb; v_now timestamp without time zone:=timezone('utc',clock_timestamp()); v_user public.users%rowtype;
  v_workspace public.workspaces%rowtype; v_member public.workspace_members%rowtype; v_voucher public.vouchers%rowtype;
  v_latest public.access_grants%rowtype; v_start timestamp without time zone; v_end timestamp without time zone; v_grant_id text;
begin
  v_ctx:=al_private.al_voucher_actor(p_actor,p_session,p_enforce);
  if v_ctx->>'denial' is not null then return v_ctx; end if;
  if p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('denial','invalid'); end if;
  select u.* into v_user from public.users u join public.sessions s on s.user_id=u.id
   where u.id=p_actor and s.id=p_session and s.jwt_id=p_session and s.revoked_at is null and s.expires_at>v_now for update of u;
  if not found then return jsonb_build_object('denial','invalid_session'); end if;
  if v_user.deleted_at is not null or (v_user.email_verified_at is null and v_user.google_sub is null and v_user.email_verification_required) then return jsonb_build_object('denial','account_ineligible'); end if;
  select * into v_voucher from public.vouchers where code_hash=p_hash for update;
  if not found or v_voucher.assigned_user_id<>p_actor or v_voucher.source<>'offline_payment' or
     v_voucher.plan_key not in ('coach_starter','coach_pro','coach_unlimited') or v_voucher.duration_days<=0 or
     v_voucher.redeemed_at is not null or v_voucher.revoked_at is not null or (v_voucher.expires_at is not null and v_voucher.expires_at<=v_now) then
    return jsonb_build_object('denial','invalid'); end if;
  update public.vouchers set redeemed_at=v_now,redeemed_by_user_id=p_actor where id=v_voucher.id
    and assigned_user_id=p_actor and redeemed_at is null and revoked_at is null and (expires_at is null or expires_at>v_now);
  if not found then return jsonb_build_object('denial','invalid'); end if;
  select * into v_workspace from public.workspaces where owner_user_id=p_actor for update;
  if not found then
    insert into public.workspaces(id,name,owner_user_id,created_at,updated_at)
    values(extensions.gen_random_uuid()::text,coalesce(nullif(btrim(v_user.display_name),''),split_part(v_user.email,'@',1))||' Coaching',p_actor,v_now,v_now)
    on conflict(owner_user_id) do nothing;
    select * into v_workspace from public.workspaces where owner_user_id=p_actor for update;
    if not found then raise exception 'workspace initialization failed'; end if;
    insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
    values(extensions.gen_random_uuid()::text,null,'WORKSPACE_CREATED','Workspace',v_workspace.id,v_now,jsonb_build_object('owner_user_id',p_actor)::text);
  end if;
  select * into v_member from public.workspace_members where workspace_id=v_workspace.id and user_id=p_actor for update;
  if not found then
    insert into public.workspace_members(id,workspace_id,user_id,role,created_at) values(extensions.gen_random_uuid()::text,v_workspace.id,p_actor,'OWNER',v_now);
    insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
    values(extensions.gen_random_uuid()::text,null,'WORKSPACE_MEMBER_ADDED','Workspace',v_workspace.id,v_now,jsonb_build_object('user_id',p_actor,'role','OWNER')::text);
  elsif v_member.role<>'OWNER' then
    raise exception 'workspace owner membership is inconsistent';
  end if;
  update public.workspaces set updated_at=v_now where id=v_workspace.id;
  select * into v_latest from public.access_grants where workspace_id=v_workspace.id and source='offline_payment'
    and plan_key=v_voucher.plan_key and revoked_at is null and expires_at>v_now order by expires_at desc,id limit 1 for update;
  v_start:=coalesce(v_latest.expires_at,v_now); v_end:=v_start+(v_voucher.duration_days*interval '1 day'); v_grant_id:=extensions.gen_random_uuid()::text;
  insert into public.access_grants(id,workspace_id,plan_key,source,starts_at,expires_at,created_by_user_id,reason,created_at)
  values(v_grant_id,v_workspace.id,v_voucher.plan_key,'offline_payment',v_start,v_end,v_voucher.created_by_user_id,'voucher:'||v_voucher.id,v_now);
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(extensions.gen_random_uuid()::text,p_actor,'VOUCHER_REDEEMED','Voucher',v_voucher.id,v_now,
    jsonb_build_object('voucher_id',v_voucher.id,'plan_key',v_voucher.plan_key,'duration_days',v_voucher.duration_days,'assigned_user_id',p_actor,'payment_reference',v_voucher.payment_reference)::text);
  insert into public.audit_events(id,actor_user_id,event_type,resource_type,resource_id,created_at,metadata_json)
  values(extensions.gen_random_uuid()::text,p_actor,'ACCESS_GRANTED','AccessGrant',v_grant_id,v_now,
    jsonb_build_object('plan_key',v_voucher.plan_key,'source','offline_payment','expires_at',v_end,'reason','voucher:'||v_voucher.id)::text);
  return jsonb_build_object('denial',null,'planKey',v_voucher.plan_key,'durationDays',v_voucher.duration_days,'grantId',v_grant_id);
end;
$function$;

revoke all on function al_private.al_voucher_redeem(text,text,boolean,text) from public,anon,authenticated,al_edge_catalog_reader;
grant execute on function al_private.al_voucher_redeem(text,text,boolean,text) to al_edge_catalog_runtime;

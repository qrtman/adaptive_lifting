-- Narrow server-only CRUD interface for the existing InsightCard contract.
-- Presets are passed from the Edge API's canonical catalog payload so SQL does
-- not maintain a second copy of their definitions.
create schema if not exists al_private;
revoke all on schema al_private from public, anon, authenticated;
grant usage on schema al_private to al_edge_catalog_runtime;

create or replace function al_private.al_insight_cards_list_or_seed(
  p_actor_user_id text,
  p_session_id text,
  p_presets jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.now());
  v_live_count bigint;
  v_preset jsonb;
  v_card_id text;
  v_cards jsonb;
begin
  if p_actor_user_id is null or p_actor_user_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_session_id is null or p_session_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or pg_catalog.jsonb_typeof(p_presets) <> 'array'
     or pg_catalog.jsonb_array_length(p_presets) <> 6 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  if not exists (
    select 1 from public.users u
    join public.sessions s on s.user_id = u.id
    where u.id = p_actor_user_id and u.deleted_at is null
      and s.id = p_session_id and s.jwt_id = p_session_id
      and s.revoked_at is null and s.expires_at > v_now
  ) then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('insight-cards:' || p_actor_user_id, 0));
  select pg_catalog.count(*) into v_live_count
  from public.insight_cards c
  where c.owner_user_id = p_actor_user_id and c.deleted_at is null;

  if v_live_count = 0 then
    for v_preset in select value from pg_catalog.jsonb_array_elements(p_presets)
    loop
      if pg_catalog.jsonb_typeof(v_preset) <> 'object'
         or pg_catalog.jsonb_typeof(v_preset->'name') <> 'string'
         or pg_catalog.jsonb_typeof(v_preset->'config') <> 'object'
         or pg_catalog.jsonb_typeof(v_preset->'layout') <> 'object' then
        return pg_catalog.jsonb_build_object('denial', 'invalid_request');
      end if;
      v_card_id := case
        when pg_catalog.jsonb_typeof(v_preset->'id') = 'string'
          then p_actor_user_id || ':' || (v_preset->>'id')
        else pg_catalog.gen_random_uuid()::text
      end;
      insert into public.insight_cards(id, owner_user_id, name, config_json, layout_json, updated_at)
      values (
        v_card_id, p_actor_user_id, v_preset->>'name',
        (v_preset->'config')::text, (v_preset->'layout')::text, v_now
      )
      on conflict (id) do nothing;
    end loop;
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'config', c.config_json::jsonb,
      'layout', coalesce(c.layout_json, '{"order":0,"col_span":1}')::jsonb,
      'updated_at', c.updated_at
    ) order by c.updated_at desc
  ), '[]'::jsonb) into v_cards
  from public.insight_cards c
  where c.owner_user_id = p_actor_user_id and c.deleted_at is null;
  return pg_catalog.jsonb_build_object('denial', null, 'cards', v_cards);
end;
$function$;

create or replace function al_private.al_insight_cards_create(
  p_actor_user_id text,
  p_session_id text,
  p_card_id text,
  p_name text,
  p_config jsonb,
  p_layout jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.now());
  v_card public.insight_cards%rowtype;
begin
  if p_actor_user_id is null or p_actor_user_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_session_id is null or p_session_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_card_id is null or pg_catalog.length(p_card_id) > 255
     or p_name is null or pg_catalog.jsonb_typeof(p_config) <> 'object'
     or pg_catalog.jsonb_typeof(p_layout) <> 'object' then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;
  if not exists (
    select 1 from public.users u join public.sessions s on s.user_id = u.id
    where u.id = p_actor_user_id and u.deleted_at is null
      and s.id = p_session_id and s.jwt_id = p_session_id
      and s.revoked_at is null and s.expires_at > v_now
  ) then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  insert into public.insight_cards(id, owner_user_id, name, config_json, layout_json, updated_at)
  values (p_card_id, p_actor_user_id, p_name, p_config::text, p_layout::text, v_now)
  returning * into v_card;
  return pg_catalog.jsonb_build_object('denial', null, 'card', pg_catalog.jsonb_build_object(
    'id', v_card.id, 'name', v_card.name, 'config', v_card.config_json::jsonb,
    'layout', coalesce(v_card.layout_json, '{"order":0,"col_span":1}')::jsonb,
    'updated_at', v_card.updated_at
  ));
end;
$function$;

create or replace function al_private.al_insight_cards_update(
  p_actor_user_id text,
  p_session_id text,
  p_card_id text,
  p_name text,
  p_config jsonb,
  p_layout jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.now());
  v_card public.insight_cards%rowtype;
begin
  if p_actor_user_id is null or p_actor_user_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_session_id is null or p_session_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_card_id is null or pg_catalog.length(p_card_id) > 255
     or p_name is null or pg_catalog.jsonb_typeof(p_config) <> 'object'
     or pg_catalog.jsonb_typeof(p_layout) <> 'object' then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;
  if not exists (
    select 1 from public.users u join public.sessions s on s.user_id = u.id
    where u.id = p_actor_user_id and u.deleted_at is null
      and s.id = p_session_id and s.jwt_id = p_session_id
      and s.revoked_at is null and s.expires_at > v_now
  ) then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  update public.insight_cards c
  set name = p_name, config_json = p_config::text, layout_json = p_layout::text, updated_at = v_now
  where c.id = p_card_id and c.owner_user_id = p_actor_user_id and c.deleted_at is null
  returning * into v_card;
  if not found then return pg_catalog.jsonb_build_object('denial', null, 'card', null); end if;
  return pg_catalog.jsonb_build_object('denial', null, 'card', pg_catalog.jsonb_build_object(
    'id', v_card.id, 'name', v_card.name, 'config', v_card.config_json::jsonb,
    'layout', coalesce(v_card.layout_json, '{"order":0,"col_span":1}')::jsonb,
    'updated_at', v_card.updated_at
  ));
end;
$function$;

create or replace function al_private.al_insight_cards_tombstone(
  p_actor_user_id text,
  p_session_id text,
  p_card_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp without time zone := pg_catalog.timezone('utc', pg_catalog.now());
begin
  if p_actor_user_id is null or p_actor_user_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_session_id is null or p_session_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$'
     or p_card_id is null or pg_catalog.length(p_card_id) > 255 then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;
  if not exists (
    select 1 from public.users u join public.sessions s on s.user_id = u.id
    where u.id = p_actor_user_id and u.deleted_at is null
      and s.id = p_session_id and s.jwt_id = p_session_id
      and s.revoked_at is null and s.expires_at > v_now
  ) then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;
  update public.insight_cards c set deleted_at = v_now
  where c.id = p_card_id and c.owner_user_id = p_actor_user_id;
  if not found then return pg_catalog.jsonb_build_object('denial', null, 'tombstoned', false); end if;
  return pg_catalog.jsonb_build_object('denial', null, 'tombstoned', true, 'status', 'tombstoned');
end;
$function$;

revoke all on function al_private.al_insight_cards_list_or_seed(text, text, jsonb) from public, anon, authenticated;
revoke all on function al_private.al_insight_cards_create(text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function al_private.al_insight_cards_update(text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function al_private.al_insight_cards_tombstone(text, text, text) from public, anon, authenticated;
grant execute on function al_private.al_insight_cards_list_or_seed(text, text, jsonb) to al_edge_catalog_runtime;
grant execute on function al_private.al_insight_cards_create(text, text, text, text, jsonb, jsonb) to al_edge_catalog_runtime;
grant execute on function al_private.al_insight_cards_update(text, text, text, text, jsonb, jsonb) to al_edge_catalog_runtime;
grant execute on function al_private.al_insight_cards_tombstone(text, text, text) to al_edge_catalog_runtime;

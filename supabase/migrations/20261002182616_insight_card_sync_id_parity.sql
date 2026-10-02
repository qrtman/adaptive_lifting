-- Transactional server-only replacement for POST /api/insight-cards/sync.
-- The Edge layer validates the application JWT and card config; this function
-- rechecks the DB session and atomically applies accepted mutations.

create or replace function al_private.al_insight_cards_sync(
  p_actor_user_id text,
  p_session_id text,
  p_client_device_id text,
  p_changes jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_now timestamp without time zone;
  v_raw_device public.client_devices%rowtype;
  v_device public.client_devices%rowtype;
  v_device_id text;
  v_change jsonb;
  v_fields jsonb;
  v_mutation_id text;
  v_entity text;
  v_card_id text;
  v_existing_result text;
  v_truthy boolean;
  v_name text;
  v_config jsonb;
  v_layout jsonb;
  v_card public.insight_cards%rowtype;
  v_accepted jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_canonical jsonb;
begin
  if p_actor_user_id is null
     or p_session_id is null
     or p_client_device_id is null
     or p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'array' then
    return pg_catalog.jsonb_build_object('denial', 'invalid_request');
  end if;

  v_now := pg_catalog.clock_timestamp() at time zone 'utc';
  if not exists (
    select 1
    from public.users u
    join public.sessions s on s.user_id = u.id
    where u.id = p_actor_user_id and u.deleted_at is null
      and s.id = p_session_id and s.jwt_id = p_session_id
      and s.revoked_at is null and s.expires_at > v_now
  ) then
    return pg_catalog.jsonb_build_object('denial', 'invalid_session');
  end if;

  -- Serialize raw-ID resolution so two users cannot both claim the same raw
  -- browser device ID. This matches ensure_client_device's namespacing rule.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('insight-card-sync:raw:' || p_client_device_id, 0)
  );
  select * into v_raw_device
  from public.client_devices d where d.id = p_client_device_id;

  if not found or v_raw_device.user_id = p_actor_user_id then
    v_device_id := p_client_device_id;
  else
    v_device_id := p_actor_user_id || ':' || p_client_device_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('insight-card-sync:device:' || v_device_id, 0)
  );
  select * into v_device from public.client_devices d where d.id = v_device_id;
  if not found then
    insert into public.client_devices (id, user_id, last_seen_at)
    values (v_device_id, p_actor_user_id, v_now)
    returning * into v_device;
  elsif v_device.revoked_at is not null or v_device.user_id is distinct from p_actor_user_id then
    return pg_catalog.jsonb_build_object('denial', 'device_revoked');
  else
    update public.client_devices d set last_seen_at = v_now
    where d.id = v_device_id returning * into v_device;
  end if;

  for v_change in select value from pg_catalog.jsonb_array_elements(p_changes)
  loop
    v_mutation_id := v_change->>'mutation_id';
    v_entity := v_change->>'entity';
    v_card_id := v_change->>'id';

    -- Legacy insight-card sync rejects other entities without recording them.
    if v_entity is distinct from 'InsightCard' then
      v_rejected := v_rejected || pg_catalog.jsonb_build_array(v_mutation_id);
      continue;
    end if;

    select m.result into v_existing_result
    from public.sync_mutations m
    where m.client_device_id = v_device_id and m.mutation_id = v_mutation_id;
    if found then
      if v_existing_result = 'ACCEPTED' then
        v_accepted := v_accepted || pg_catalog.jsonb_build_array(v_mutation_id);
      else
        v_rejected := v_rejected || pg_catalog.jsonb_build_array(v_mutation_id);
      end if;
      continue;
    end if;

    -- Legacy CardConfig schema failures abort the whole request and roll back
    -- the SQLAlchemy transaction. Defer the same failure until after existing
    -- idempotency records are checked, then force this transaction to roll back.
    if coalesce((v_change->>'_schema_error')::boolean, false) then
      raise exception using errcode = 'P0001', message = 'AL_SYNC_CARD_CONFIG_SCHEMA';
    end if;

    if coalesce((v_change->>'_compatibility_rejected')::boolean, false) then
      v_rejected := v_rejected || pg_catalog.jsonb_build_array(v_mutation_id);
      continue;
    end if;

    v_fields := coalesce(v_change->'fields', '{}'::jsonb);
    v_truthy := case pg_catalog.jsonb_typeof(v_fields->'deleted')
      when 'boolean' then (v_fields->>'deleted')::boolean
      when 'number' then (v_fields->>'deleted')::numeric <> 0
      when 'string' then pg_catalog.length(v_fields->>'deleted') > 0
      when 'array' then pg_catalog.jsonb_array_length(v_fields->'deleted') > 0
      when 'object' then v_fields->'deleted' <> '{}'::jsonb
      else false
    end;

    select * into v_card
    from public.insight_cards c
    where c.id = v_card_id and c.owner_user_id = p_actor_user_id
    for update;

    if v_truthy then
      if found then
        update public.insight_cards c
        set deleted_at = pg_catalog.clock_timestamp() at time zone 'utc'
        where c.id = v_card_id and c.owner_user_id = p_actor_user_id;
      end if;
    else
      if not found then
        v_truthy := case pg_catalog.jsonb_typeof(v_fields->'name')
          when 'boolean' then (v_fields->>'name')::boolean
          when 'number' then (v_fields->>'name')::numeric <> 0
          when 'string' then pg_catalog.length(v_fields->>'name') > 0
          when 'array' then pg_catalog.jsonb_array_length(v_fields->'name') > 0
          when 'object' then v_fields->'name' <> '{}'::jsonb
          else false
        end;
        v_name := case when v_truthy then v_fields->>'name' else 'Card' end;

        v_truthy := case pg_catalog.jsonb_typeof(v_fields->'config')
          when 'boolean' then (v_fields->>'config')::boolean
          when 'number' then (v_fields->>'config')::numeric <> 0
          when 'string' then pg_catalog.length(v_fields->>'config') > 0
          when 'array' then pg_catalog.jsonb_array_length(v_fields->'config') > 0
          when 'object' then v_fields->'config' <> '{}'::jsonb
          else false
        end;
        v_config := case when v_truthy then v_fields->'config' else '{}'::jsonb end;

        v_truthy := case pg_catalog.jsonb_typeof(v_fields->'layout')
          when 'boolean' then (v_fields->>'layout')::boolean
          when 'number' then (v_fields->>'layout')::numeric <> 0
          when 'string' then pg_catalog.length(v_fields->>'layout') > 0
          when 'array' then pg_catalog.jsonb_array_length(v_fields->'layout') > 0
          when 'object' then v_fields->'layout' <> '{}'::jsonb
          else false
        end;
        v_layout := case when v_truthy then v_fields->'layout' else '{"order":0,"col_span":1}'::jsonb end;

        insert into public.insight_cards (id, owner_user_id, name, config_json, layout_json, updated_at)
        values (
          v_card_id, p_actor_user_id, v_name,
          v_config::text, v_layout::text,
          pg_catalog.clock_timestamp() at time zone 'utc'
        );
      else
        update public.insight_cards c set
          name = case when v_fields ? 'name' then v_fields->>'name' else c.name end,
          config_json = case when v_fields ? 'config' then (v_fields->'config')::text else c.config_json end,
          layout_json = case when v_fields ? 'layout' then (v_fields->'layout')::text else c.layout_json end,
          deleted_at = null,
          updated_at = pg_catalog.clock_timestamp() at time zone 'utc'
        where c.id = v_card_id and c.owner_user_id = p_actor_user_id;
      end if;
    end if;

    -- PostgreSQL's timestamp-without-time-zone input ignores an ISO offset,
    -- matching Python's isoparse(...).replace(tzinfo=None) for client times.
    insert into public.sync_mutations (
      mutation_id, client_device_id, entity_type, entity_id, field_path,
      updated_at, applied_at, result
    ) values (
      v_mutation_id,
      v_device_id,
      'InsightCard',
      v_card_id,
      'ALL',
      case when coalesce(v_change->>'updated_at', '') = ''
        then pg_catalog.clock_timestamp() at time zone 'utc'
        else (v_change->>'updated_at')::timestamp without time zone
      end,
      pg_catalog.clock_timestamp() at time zone 'utc',
      'ACCEPTED'
    );
    v_accepted := v_accepted || pg_catalog.jsonb_build_array(v_mutation_id);
  end loop;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'config', c.config_json::jsonb,
    'layout', coalesce(c.layout_json, '{"order":0,"col_span":1}')::jsonb,
    'updated_at', c.updated_at
  )), '[]'::jsonb) into v_canonical
  from public.insight_cards c
  where c.owner_user_id = p_actor_user_id and c.deleted_at is null;

  return pg_catalog.jsonb_build_object(
    'denial', null,
    'accepted_mutation_ids', v_accepted,
    'rejected_mutation_ids', v_rejected,
    'canonical', v_canonical
  );
end;
$function$;

revoke all on function al_private.al_insight_cards_sync(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function al_private.al_insight_cards_sync(text, text, text, jsonb)
  to al_edge_catalog_runtime;

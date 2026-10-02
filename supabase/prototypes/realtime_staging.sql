-- STAGING PROTOTYPE ONLY. Apply only after confirming adaptive-lifting-staging.
-- The issuer can validate application sessions and read workout ownership.
-- The subscriber has no access to application tables.
create role al_realtime_issuer nologin;
grant al_edge_catalog_reader to al_realtime_issuer;
grant select (id, owner_id, deleted_at)
  on table public.workouts to al_realtime_issuer;

create role al_realtime_subscriber nologin;
grant al_realtime_subscriber to authenticator;
grant usage on schema realtime to al_realtime_subscriber;
grant select on table realtime.messages to al_realtime_subscriber;

-- There is deliberately no INSERT policy: the subscriber only receives
-- server-originated Broadcasts. The JWT's topic is checked at channel join.
create policy al_spike_workout_broadcast_receive
  on realtime.messages for select to al_realtime_subscriber
  using (
    extension = 'broadcast'
    and realtime.topic() = current_setting('request.jwt.claims', true)::jsonb ->> 'rt_topic'
    and current_setting('request.jwt.claims', true)::jsonb ->> 'purpose'
      = 'workout_broadcast_spike'
    and realtime.topic() like 'workout:%'
  );

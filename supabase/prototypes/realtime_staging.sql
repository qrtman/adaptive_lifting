-- Reference mirror of the applied staging migration:
-- 20261002152646_realtime_private_broadcast_subscriber.sql
-- Do not run this file independently or enable RLS here. Supabase owns the
-- existing realtime.messages RLS setting.

create role al_realtime_subscriber
  nologin noinherit nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls;

grant al_realtime_subscriber to authenticator;
grant usage on schema realtime to al_realtime_subscriber;
grant select on table realtime.messages to al_realtime_subscriber;

-- The application Edge runtime can check ownership using these three columns.
grant select (id, owner_id, deleted_at)
  on table public.workouts to al_edge_catalog_runtime;

create policy al_realtime_workout_broadcast_receive
  on realtime.messages
  for select
  to al_realtime_subscriber
  using (
    extension = 'broadcast'
    and realtime.topic() =
      (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'rt_topic')
    and realtime.topic() = 'workout:' ||
      (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'workout_id')
    and (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub') =
      (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'app_user_id')
    and (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'purpose') =
      'adaptive_lifting_realtime'
  );

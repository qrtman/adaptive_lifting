-- Remove the staging experiment after evidence is captured. Delete any
-- temporary LOGIN roles and project secrets separately before these groups.
drop policy if exists al_spike_workout_broadcast_receive on realtime.messages;
revoke select on table realtime.messages from al_realtime_subscriber;
revoke usage on schema realtime from al_realtime_subscriber;
revoke al_realtime_subscriber from authenticator;
drop role if exists al_realtime_subscriber;
revoke select (id, owner_id, deleted_at)
  on table public.workouts from al_realtime_issuer;
revoke al_edge_catalog_reader from al_realtime_issuer;
drop role if exists al_realtime_issuer;

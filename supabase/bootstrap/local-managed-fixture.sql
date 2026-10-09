-- LOCAL HARNESS ONLY. Never use this to replace a Supabase managed schema.
-- These are NOLOGIN SQL test identities, not Auth or PostgREST services.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticator NOLOGIN;
CREATE SCHEMA realtime;
-- SQL interface needed by migration 20261002152646. This is NOT a running
-- Realtime server; partition lifecycle/Broadcast delivery are out of scope.
CREATE TABLE realtime.messages (
  topic text NOT NULL, extension text NOT NULL, payload jsonb, event text,
  private boolean DEFAULT false,
  updated_at timestamp NOT NULL DEFAULT now(), inserted_at timestamp NOT NULL DEFAULT now(),
  id uuid NOT NULL DEFAULT gen_random_uuid(), binary_payload bytea,
  skip_broadcast boolean NOT NULL DEFAULT false,
  PRIMARY KEY(id,inserted_at)
) PARTITION BY RANGE(inserted_at);
CREATE TABLE realtime.messages_local PARTITION OF realtime.messages DEFAULT;
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('realtime.topic',true),'')::text;
$$;
-- Reproduce managed default grants so privacy checks exercise their removal.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;

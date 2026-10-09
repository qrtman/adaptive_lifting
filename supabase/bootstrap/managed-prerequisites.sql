-- Run before application.sql on an EMPTY, separately approved Supabase target.
-- No credentials or environment-specific values. Managed roles/Realtime must
-- already exist; the local harness supplies only their documented SQL contract.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
DO $$ DECLARE v_id uuid; v_test text; BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto' AND extnamespace='extensions'::regnamespace) THEN
    RAISE EXCEPTION 'pgcrypto must live in extensions; do not silently relocate a managed extension';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['postgres','anon','authenticated','service_role','authenticator']) r
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r)) THEN
    RAISE EXCEPTION 'Required Supabase managed roles missing';
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NULL OR to_regclass('realtime.messages') IS NULL
     OR to_regprocedure('realtime.topic()') IS NULL THEN
    RAISE EXCEPTION 'Required Supabase Vault/Realtime service objects missing';
  END IF;
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Historical migration CONNECT grant and pg_cron require database postgres';
  END IF;
  -- Fail early if the managed Vault root-key provider is not operational.
  -- This random probe is deleted within this transaction and is never printed.
  v_test := encode(extensions.gen_random_bytes(32),'hex');
  v_id := vault.create_secret(v_test);
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE id=v_id AND decrypted_secret=v_test) THEN
    RAISE EXCEPTION 'Vault encryption/decryption prerequisite failed';
  END IF;
  DELETE FROM vault.secrets WHERE id=v_id;
END $$;
COMMIT;

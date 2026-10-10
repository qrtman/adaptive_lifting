BEGIN;
INSERT INTO public.users(id,email,hashed_password,role) VALUES
  ('bootstrap-athlete','bootstrap-athlete@example.invalid','not-a-login-hash','ATHLETE'),
  ('bootstrap-coach','bootstrap-coach@example.invalid','not-a-login-hash','COACH');
DO $$ BEGIN
  IF NOT (SELECT email_verification_required AND NOT email_verification_legacy_exempt
          FROM public.users WHERE id='bootstrap-athlete') THEN
    RAISE EXCEPTION 'Secure verification defaults missing';
  END IF;
  BEGIN
    INSERT INTO public.users(id,email,hashed_password,role)
      VALUES ('bootstrap-duplicate','bootstrap-athlete@example.invalid','unused','ATHLETE');
    RAISE EXCEPTION 'Email uniqueness not enforced';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.sessions(id,user_id,expires_at) VALUES ('bad-fk','no-user',now());
    RAISE EXCEPTION 'Session FK not enforced';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  -- Use explicit IDs here: PostgreSQL nextval() is not rolled back, so the
  -- production rollback-only core check must not consume sequence values.
  INSERT INTO public.coaching_relationships(id,coach_id,athlete_id)
    VALUES (-910001,'bootstrap-coach','bootstrap-athlete');
  BEGIN
    INSERT INTO public.coaching_relationships(id,coach_id,athlete_id)
      VALUES (-910002,'bootstrap-coach','bootstrap-athlete');
    RAISE EXCEPTION 'Active relationship uniqueness not enforced';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE public.coaching_relationships SET ended_at=now() WHERE id=-910001;
  INSERT INTO public.coaching_relationships(id,coach_id,athlete_id)
    VALUES (-910003,'bootstrap-coach','bootstrap-athlete');
  INSERT INTO public.workspaces(id,name,owner_user_id,created_at,updated_at)
    VALUES ('bootstrap-workspace','fixture','bootstrap-coach',now(),now());
  BEGIN
    INSERT INTO public.workspace_members(id,workspace_id,user_id,role,created_at)
      VALUES ('bad-role','bootstrap-workspace','bootstrap-athlete','INVALID',now());
    RAISE EXCEPTION 'Workspace role check not enforced';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.voucher_redemption_limits VALUES ('bad-count',now(),-1,now(),0,now());
    RAISE EXCEPTION 'Rate count check not enforced';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.email_verification_tokens(id,user_id,token_hash,created_at,expires_at,is_resend)
      VALUES ('bad-hash','bootstrap-athlete','short',now(),now()+interval '1 hour',false);
    RAISE EXCEPTION 'Token hash check not enforced';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.email_verification_tokens(id,user_id,token_hash,created_at,expires_at,is_resend)
      VALUES ('bad-expiry','bootstrap-athlete',repeat('a',64),now(),now()-interval '1 hour',false);
    RAISE EXCEPTION 'Token expiry check not enforced';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO public.email_verification_tokens(id,user_id,token_hash,created_at,expires_at,is_resend)
    VALUES ('valid-token','bootstrap-athlete',repeat('a',64),now(),now()+interval '1 hour',false);
  BEGIN
    INSERT INTO public.email_verification_tokens(id,user_id,token_hash,created_at,expires_at,is_resend)
      VALUES ('duplicate-active','bootstrap-athlete',repeat('b',64),now(),now()+interval '1 hour',false);
    RAISE EXCEPTION 'Active token uniqueness not enforced';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.subscriptions(id,workspace_id,provider,provider_subscription_id,plan_key,status,cancel_at_period_end,created_at,updated_at)
      VALUES ('bad-status','bootstrap-workspace','fixture','fixture','fixture','INVALID',false,now(),now());
    RAISE EXCEPTION 'Subscription status check not enforced';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.billing_checkout_reservations(id,workspace_id,provider,request_id,plan_key,status,created_at,updated_at)
      VALUES ('bad-checkout','bootstrap-workspace','fixture','fixture','fixture','INVALID',now(),now());
    RAISE EXCEPTION 'Checkout status check not enforced';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.vouchers(id,code_hash,plan_key,duration_days,source,created_at)
      VALUES ('bad-voucher','fixture','fixture',0,'fixture',now());
    RAISE EXCEPTION 'Voucher duration check not enforced';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO public.client_devices(id,user_id) VALUES ('bootstrap-device-a','bootstrap-athlete'),('bootstrap-device-b','bootstrap-athlete');
INSERT INTO public.sync_mutations(mutation_id,client_device_id,entity_type,entity_id,field_path,updated_at)
  VALUES ('same-mutation','bootstrap-device-a','fixture','fixture','fixture',now()),
         ('same-mutation','bootstrap-device-b','fixture','fixture','fixture',now());
DO $$ BEGIN
  BEGIN
    INSERT INTO public.sync_mutations(mutation_id,client_device_id,entity_type,entity_id,field_path,updated_at)
      VALUES ('same-mutation','bootstrap-device-a','fixture','fixture','fixture',now());
    RAISE EXCEPTION 'Device-scoped idempotency not enforced';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF EXISTS (SELECT 1 FROM pg_tables t WHERE schemaname='public'
      AND (has_table_privilege('anon',format('%I.%I',schemaname,tablename),'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('authenticated',format('%I.%I',schemaname,tablename),'SELECT,INSERT,UPDATE,DELETE'))) THEN
    RAISE EXCEPTION 'Application table accessible to browser database roles';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='al_private'
      AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION 'Private RPC accessible to browser database roles';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('al_edge_catalog_runtime','al_edge_catalog_reader','al_realtime_subscriber')
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'Unexpected application role escalation';
  END IF;
  IF to_regprocedure('al_private.set_offline_auth_private_key_once(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Temporary staging provisioner survived replay';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname IN ('email-verification-edge-worker','al-google-sheets-worker'))<>2 THEN
    RAISE EXCEPTION 'Cron definitions missing';
  END IF;
END $$;
ROLLBACK;

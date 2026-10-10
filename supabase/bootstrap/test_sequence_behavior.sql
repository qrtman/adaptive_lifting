-- Local-only because PostgreSQL sequence increments survive transaction rollback.
BEGIN;
INSERT INTO public.users(id,email,hashed_password,role) VALUES
  ('bootstrap-athlete','bootstrap-athlete@example.invalid','not-a-login-hash','ATHLETE'),
  ('bootstrap-coach','bootstrap-coach@example.invalid','not-a-login-hash','COACH');
DO $$ DECLARE a integer; b integer; BEGIN
  INSERT INTO public.coaching_relationships(coach_id,athlete_id)
    VALUES ('bootstrap-coach','bootstrap-athlete') RETURNING id INTO a;
  BEGIN
    INSERT INTO public.coaching_relationships(coach_id,athlete_id)
      VALUES ('bootstrap-coach','bootstrap-athlete');
    RAISE EXCEPTION 'Active relationship uniqueness not enforced';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  UPDATE public.coaching_relationships SET ended_at=now() WHERE id=a;
  INSERT INTO public.coaching_relationships(coach_id,athlete_id)
    VALUES ('bootstrap-coach','bootstrap-athlete') RETURNING id INTO b;
  IF b<=a THEN RAISE EXCEPTION 'Relationship sequence does not advance'; END IF;
END $$;
ROLLBACK;

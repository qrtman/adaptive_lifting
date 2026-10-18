-- Fixture-only SQL authorization test. This is not a WebSocket test.
-- local-managed-fixture.sql supplies a DEFAULT partition for this purpose.
BEGIN;
INSERT INTO realtime.messages(topic,extension,private) VALUES
  ('workout:bootstrap-workout','broadcast',true),('workout:other','broadcast',true);
SET LOCAL ROLE al_realtime_subscriber;
SET LOCAL realtime.topic='workout:bootstrap-workout';
SET LOCAL request.jwt.claims='{"rt_topic":"workout:bootstrap-workout","workout_id":"bootstrap-workout","sub":"bootstrap-athlete","app_user_id":"bootstrap-athlete","purpose":"adaptive_lifting_realtime"}';
DO $$ BEGIN
  -- Realtime's managed authorization query selects the requested topic.
  -- The policy authorizes the channel context, not arbitrary SQL row browsing.
  IF (SELECT count(*) FROM realtime.messages WHERE topic=realtime.topic())<>1 THEN
    RAISE EXCEPTION 'Realtime SQL policy did not authorize the requested workout';
  END IF;
END $$;
SET LOCAL request.jwt.claims='{"rt_topic":"workout:bootstrap-workout","workout_id":"bootstrap-workout","sub":"different-user","app_user_id":"bootstrap-athlete","purpose":"adaptive_lifting_realtime"}';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM realtime.messages) THEN
    RAISE EXCEPTION 'Realtime SQL policy allowed mismatched identity';
  END IF;
END $$;
SET LOCAL ROLE postgres;
ROLLBACK;

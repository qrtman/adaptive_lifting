import { exportJWK, importJWK, jwtVerify, SignJWT } from "jose";
import type { AppConfig } from "../functions/_shared/config.ts";
import type { Database } from "../functions/_shared/db/mod.ts";
import { createRealtimeTokenHandler } from "../functions/realtime-token-spike/handler.ts";
import {
  issueRealtimeToken,
  REALTIME_PURPOSE,
  REALTIME_ROLE,
  REALTIME_TOKEN_TTL_SECONDS,
  type RealtimeSigner,
} from "../functions/realtime-token-spike/token.ts";

const userId = "8cae9130-ef47-4a54-889d-9b2a0899598b";
const workoutId = "e025906e-4c21-4cb8-81b9-d2e2c057e451";
const sessionId = "c67c4a0f-a369-43da-8b42-6284d20c1968";
const secret = "test-only-app-signing-key-at-least-32-characters";
const config: AppConfig = {
  databaseUrl: "postgresql://unused:unused@localhost/postgres",
  jwtCurrent: secret,
  jwtPrevious: null,
  enforceLegacyEmailVerification: false,
  allowedOrigins: ["https://staging.example.test"],
};

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

async function signingKeys(): Promise<
  { signer: RealtimeSigner; publicKey: CryptoKey }
> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    signer: { jwk: await exportJWK(pair.privateKey), kid: "staging-test-key" },
    publicKey: pair.publicKey,
  };
}

function fakeDatabase(
  options: { revoked?: boolean; owns?: boolean } = {},
): Database {
  return {
    connect: () =>
      Promise.resolve({
        queryObject: <T>(
          query: string,
          params?: unknown[],
        ): Promise<{ rows: T[] }> => {
          if (query.includes("public.sessions")) {
            return Promise.resolve({
              rows: [{
                id: sessionId,
                user_id: userId,
                jwt_id: sessionId,
                revoked_at: options.revoked ? "2026-01-01T00:00:00" : null,
                active: true,
              }] as T[],
            });
          }
          if (query.includes("public.users")) {
            return Promise.resolve({
              rows: [{
                id: userId,
                google_sub: null,
                email_verified_at: "2026-01-01T00:00:00",
                email_verification_required: true,
                email_verification_legacy_exempt: false,
                deleted_at: null,
              }] as T[],
            });
          }
          if (query.includes("public.workouts")) {
            assert(params?.[0] === workoutId && params?.[1] === userId);
            return Promise.resolve({
              rows: options.owns === false ? [] : [{ id: workoutId }] as T[],
            });
          }
          throw new Error("unexpected SQL");
        },
        release: () => {},
      }),
  };
}

async function appRequest(): Promise<Request> {
  const token = await new SignJWT({ session_id: sessionId })
    .setProtectedHeader({ alg: "HS256", kid: "current" })
    .setSubject(userId).setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
  return new Request(
    "https://staging.example.test/functions/v1/realtime-token-spike",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://staging.example.test",
        Cookie: `session_id=${token}`,
      },
      body: JSON.stringify({ workout_id: workoutId }),
    },
  );
}

Deno.test("Realtime capability has a separate ES256 key, restricted role, exact topic and 60-second expiry", async () => {
  const { signer, publicKey } = await signingKeys();
  const now = 1_800_000_000;
  const issued = await issueRealtimeToken(userId, workoutId, signer, now);
  assert(issued.expires_at - now === REALTIME_TOKEN_TTL_SECONDS);
  assert(issued.topic === `workout:${workoutId}`);
  const { payload, protectedHeader } = await jwtVerify(
    issued.token,
    publicKey,
    {
      algorithms: ["ES256"],
      currentDate: new Date((now + 1) * 1000),
    },
  );
  assert(protectedHeader.kid === signer.kid);
  assert(payload.sub === userId && payload.role === REALTIME_ROLE);
  assert(
    payload.purpose === REALTIME_PURPOSE && payload.rt_topic === issued.topic,
  );
  assert(payload.exp === now + REALTIME_TOKEN_TTL_SECONDS);
  assert(!("session_id" in payload));
  let expired = false;
  try {
    await jwtVerify(issued.token, publicKey, {
      currentDate: new Date((now + 61) * 1000),
    });
  } catch {
    expired = true;
  }
  assert(
    expired,
    "expired capability must fail signature-library verification",
  );
});

Deno.test("issuer only mints after live app session and workout ownership checks", async () => {
  const { signer, publicKey } = await signingKeys();
  for (
    const [db, expected] of [
      [fakeDatabase(), 200],
      [fakeDatabase({ owns: false }), 403],
      [fakeDatabase({ revoked: true }), 401],
    ] as const
  ) {
    const response = await createRealtimeTokenHandler(config, db, signer)(
      await appRequest(),
    );
    assert(
      response.status === expected,
      `expected ${expected}, got ${response.status}`,
    );
    assert(response.headers.get("Cache-Control") === "no-store");
    assert(
      response.headers.get("Access-Control-Allow-Origin") ===
        "https://staging.example.test",
    );
    if (expected === 200) {
      const body = await response.json();
      const key = await importJWK(await exportJWK(publicKey), "ES256");
      const { payload } = await jwtVerify(body.token, key);
      assert(payload.rt_topic === `workout:${workoutId}`);
    }
  }
});

Deno.test("issuer denies unapproved browser origin", async () => {
  const { signer } = await signingKeys();
  const request = await appRequest();
  request.headers.set("Origin", "https://attacker.example");
  const response = await createRealtimeTokenHandler(
    config,
    fakeDatabase(),
    signer,
  )(request);
  assert(response.status === 403);
  assert(!response.headers.has("Access-Control-Allow-Origin"));
});

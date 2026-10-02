import { importJWK, type JWK, SignJWT } from "jose";

export const REALTIME_TOKEN_TTL_SECONDS = 60;
export const REALTIME_ROLE = "al_realtime_subscriber";
export const REALTIME_PURPOSE = "workout_broadcast_spike";

export interface RealtimeSigner {
  jwk: JWK;
  kid: string;
}

export function signerFromEnv(
  read = (name: string) => Deno.env.get(name),
): RealtimeSigner {
  const raw = read("REALTIME_SIGNING_JWK");
  const kid = read("REALTIME_SIGNING_KID")?.trim();
  if (!raw || !kid) {
    throw new Error("Realtime signing key and kid are required");
  }
  const jwk = JSON.parse(raw) as JWK;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d) {
    throw new Error("Realtime signing key must be a private P-256 JWK");
  }
  return { jwk, kid };
}

export async function issueRealtimeToken(
  userId: string,
  workoutId: string,
  signer: RealtimeSigner,
  now = Math.floor(Date.now() / 1000),
): Promise<{ token: string; topic: string; expires_at: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f-]{36}$/i.test(workoutId)) {
    throw new Error("Realtime identity and workout must be UUIDs");
  }
  const topic = `workout:${workoutId}`;
  const expires_at = now + REALTIME_TOKEN_TTL_SECONDS;
  const key = await importJWK(signer.jwk, "ES256");
  const token = await new SignJWT({
    role: REALTIME_ROLE,
    purpose: REALTIME_PURPOSE,
    rt_topic: topic,
  }).setProtectedHeader({ alg: "ES256", kid: signer.kid, typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(expires_at)
    .setJti(crypto.randomUUID())
    .sign(key);
  return { token, topic, expires_at };
}

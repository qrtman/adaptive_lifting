import { importJWK, jwtVerify, type JWK, SignJWT } from "jose";

export const REALTIME_TOKEN_TTL_SECONDS = 60;
export const REALTIME_ROLE = "al_realtime_subscriber";
export const REALTIME_PURPOSE = "adaptive_lifting_realtime";
export const REALTIME_SIGNING_KID =
  "ce24a866-49d1-4f0e-bde5-9c5e05a70210";

export interface RealtimeSigner {
  jwk: JWK;
  kid: string;
}

export function signerFromEnv(
  read = (name: string) => Deno.env.get(name),
): RealtimeSigner {
  const raw = read("REALTIME_JWT_PRIVATE_JWK");
  if (!raw) throw new Error("REALTIME_JWT_PRIVATE_JWK is required");
  let jwk: JWK;
  try {
    jwk = JSON.parse(raw) as JWK;
  } catch {
    throw new Error("Realtime signing key must be valid JSON");
  }
  if (
    !jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.x || !jwk.y
  ) {
    throw new Error("Realtime signing key must be a private P-256 JWK");
  }
  const configuredKid = read("REALTIME_JWT_KEY_ID")?.trim();
  const jwkKid = jwk.kid;
  const production = ["production", "prod"].includes(
    (read("APP_ENV") || read("ENV") || "").trim().toLowerCase(),
  );
  if (configuredKid && jwkKid && configuredKid !== jwkKid) {
    throw new Error("Realtime configured key ID and JWK kid must match");
  }
  const kid = configuredKid || jwkKid || (production ? undefined : REALTIME_SIGNING_KID);
  if (typeof kid !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(kid)) {
    throw new Error("Realtime signing key requires a valid key ID");
  }
  if (production && kid === REALTIME_SIGNING_KID) {
    throw new Error("Production Realtime signing key must have an independent key ID");
  }
  // Supabase's exported verification JWK metadata can carry verify-only
  // key_ops. Strip metadata and import the private coordinates explicitly
  // for ES256 signing; never copy or log the secret value.
  return {
    jwk: {
      kty: "EC",
      crv: "P-256",
      x: jwk.x,
      y: jwk.y,
      d: jwk.d,
      alg: "ES256",
      key_ops: ["sign"],
      ext: true,
    },
    kid,
  };
}

export async function loadRealtimeSigner(
  read = (name: string) => Deno.env.get(name),
): Promise<RealtimeSigner> {
  const signer = signerFromEnv(read);
  try {
    const key = await importJWK(signer.jwk, "ES256");
    // Exercise the signing operation before the API starts. Nonempty JWK
    // coordinates alone do not establish that the private key is usable.
    const proof = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256" })
      .sign(key);
    const verificationKey = await importJWK({
      kty: "EC", crv: "P-256", x: signer.jwk.x, y: signer.jwk.y,
      alg: "ES256", key_ops: ["verify"], ext: true,
    }, "ES256");
    await jwtVerify(proof, verificationKey, { algorithms: ["ES256"] });
  } catch {
    // Crypto errors may contain key details; expose only the config failure.
    throw new Error("Realtime signing key must be usable for ES256 signing");
  }
  return signer;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export async function issueRealtimeToken(
  userId: string,
  workoutId: string,
  signer: RealtimeSigner,
  now = Math.floor(Date.now() / 1000),
): Promise<{ token: string; topic: string; expires_at: number }> {
  if (!SAFE_ID.test(userId) || !SAFE_ID.test(workoutId)) {
    throw new Error("Realtime identity and workout IDs are invalid");
  }
  const topic = `workout:${workoutId}`;
  const expires_at = now + REALTIME_TOKEN_TTL_SECONDS;
  const key = await importJWK(signer.jwk, "ES256");
  const token = await new SignJWT({
    role: REALTIME_ROLE,
    purpose: REALTIME_PURPOSE,
    rt_topic: topic,
    app_user_id: userId,
    workout_id: workoutId,
  }).setProtectedHeader({ alg: "ES256", kid: signer.kid, typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(expires_at)
    .setJti(crypto.randomUUID())
    .sign(key);
  return { token, topic, expires_at };
}

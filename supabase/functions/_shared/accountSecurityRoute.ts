import { SignJWT, importPKCS8 } from "jose";
import type { AppConfig } from "./config.ts";
import { authRepository, type Database, type SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import { authenticate, requestToken } from "./auth/session.ts";
import { verifyAppJwt } from "./auth/jwt.ts";
import type { Principal } from "./types/mod.ts";

type Json = Record<string, unknown>;

async function rpc<T extends Json>(
  db: Database,
  query: string,
  values: unknown[],
): Promise<T> {
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: T }>(query, values);
    if (!result.rows[0]) throw new Error("Account security RPC returned no row");
    return result.rows[0].payload;
  } finally {
    client.release();
  }
}

function failOnDenial(result: Json): Json {
  const denial = result.denial;
  if (denial == null) return result;
  const map: Record<string, [number, string | Json]> = {
    invalid_request: [422, "Invalid request"],
    invalid_credentials: [400, "Incorrect email or password"],
    rate_limited: [429, "Too many authentication attempts"],
    account_ineligible: [403, { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before signing in." }],
    account_unavailable: [403, "This account is unavailable"],
    invalid_display_name: [422, "Display name must be 80 characters or fewer"],
    invalid_session: [401, "Could not validate credentials"],
    only_coaches_create: [403, "Only coaches can create coach codes"],
    only_coaches_view: [403, "Only coaches can view coach codes"],
    only_athletes_link: [403, "Only athletes can link to a coach"],
    invalid_invite: [404, "Invalid or expired coach code"],
    coach_not_found: [404, "Coach not found for this code"],
    already_linked: [400, "Athlete is already linked to a coach"],
    no_active_link: [404, "No active coaching link"],
    coach_generic_unlink: [400, "Coaches must unlink a specific athlete via DELETE /api/auth/link/{athlete_id}"],
    coach_unlink_only: [403, "Only coaches can unlink athletes by id"],
    coach_not_linked: [403, "Not linked to this athlete"],
    push_forbidden: [403, "Not authorized to push to this athlete"],
    programming_required: [403, { code: "FEATURE_NOT_INCLUDED", feature: "programming", message: "This coaching plan does not include programming." }],
    workspace_access_required: [403, { code: "WORKSPACE_ACCESS_REQUIRED", message: "An active coaching plan is required." }],
    device_not_found: [404, "Device not found"],
    security_session_not_found: [404, "Session not found"],
    history_not_found: [404, "Past athlete history not found"],
    history_unavailable: [404, "History snapshot is unavailable for this past link"],
    not_authorized: [403, "Not authorized"],
  };
  if (denial === "athlete_limit_reached") {
    throw new ApiError(409, {
      code: "ATHLETE_LIMIT_REACHED",
      message: "This coaching account has reached its active athlete limit.",
      activeAthletes: result.activeAthletes,
      maxActiveAthletes: result.maxActiveAthletes,
    });
  }
  const [status, detail] = map[String(denial)] ?? [500, "Internal server error"];
  throw new ApiError(status, detail);
}

function sqlJson(result: Json): Json {
  return failOnDenial(result);
}

function routeError(status: number, detail: string | Json | Array<Record<string, unknown>>): never {
  throw new ApiError(status, detail);
}

function userJson(user: Principal["user"]): Json {
  return {
    id: user.id,
    email: user.email ?? "",
    role: user.role ?? "ATHLETE",
    displayName: user.display_name ?? null,
  };
}

function setCookie(token: string, config: AppConfig): string {
  const parts = [
    `session_id=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=lax",
    `Max-Age=${config.sessionLifetimeSeconds ?? 604800}`,
  ];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(config: AppConfig): string {
  const parts = ["session_id=", "Path=/", "HttpOnly", "SameSite=lax", "Max-Age=0"];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function enforceBrowserWriteOrigin(request: Request, config: AppConfig): void {
  if (!config.cookieSecure || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  let origin = request.headers.get("origin");
  if (!origin) {
    const referer = request.headers.get("referer");
    if (referer) {
      try { origin = new URL(referer).origin; } catch { origin = ""; }
    }
  }
  const hasCookie = (request.headers.get("cookie") ?? "").split(";").some((part) => part.trim().startsWith("session_id="));
  if ((origin && !config.allowedOrigins.includes(origin)) || (!origin && hasCookie)) {
    throw new ApiError(403, "Untrusted request origin");
  }
}

async function offlineGrant(
  db: Database,
  config: AppConfig,
  user: Json,
  sessionId: string,
  sessionExpiresAt: string,
  scopes: string[],
): Promise<string | null> {
  let pem = config.offlineAuthPrivateKey;
  if (!pem) {
    const client: SqlClient = await db.connect();
    try {
      const result = await client.queryObject<{ private_key: string }>(
        "select al_private.get_offline_auth_private_key() as private_key",
      );
      pem = result.rows[0]?.private_key?.trim() || null;
    } catch {
      // Offline auth is optional. Missing or inaccessible signing material must
      // never prevent the online /auth/me response or produce an unsigned grant.
      return null;
    } finally {
      client.release();
    }
  }
  if (!pem) return null;
  const now = Math.floor(Date.now() / 1000);
  const exp = Math.min(Math.floor(new Date(sessionExpiresAt).getTime() / 1000), now + 86400);
  if (!Number.isFinite(exp) || exp <= now) return null;
  const key = await importPKCS8(pem, "ES256");
  return await new SignJWT({ sid: sessionId, scopes, user })
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer("adaptive-lifting")
    .setAudience("adaptive-lifting-offline")
    .setSubject(String(user.id))
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);
}

async function authenticated(
  request: Request,
  db: Database,
  config: AppConfig,
): Promise<Principal> {
  return await authenticate(request, authRepository(db), config);
}

async function jsonBody(request: Request): Promise<Json> {
  const value = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    routeError(422, [{ loc: ["body"], msg: "Input should be a valid object", type: "model_type" }]);
  }
  return value as Json;
}

async function login(request: Request, db: Database, config: AppConfig): Promise<Response> {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") {
    routeError(422, [{ loc: ["body"], msg: "Field required", type: "missing" }]);
  }
  const form = new URLSearchParams(await request.text());
  const username = form.get("username");
  const password = form.get("password");
  if (username === null || password === null) {
    routeError(422, [
      ...(username === null ? [{ loc: ["body", "username"], msg: "Field required", type: "missing" }] : []),
      ...(password === null ? [{ loc: ["body", "password"], msg: "Field required", type: "missing" }] : []),
    ]);
  }
  const email = username.trim().toLowerCase();
  const address = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const subjectHash = await sha256Hex(`auth:${address}`);
  const sessionId = crypto.randomUUID();
  const result = sqlJson(await rpc(db,
    "select al_private.al_auth_login($1::text,$2::text,$3::text,$4::text,$5::boolean) as payload",
    [email, password, subjectHash, sessionId, config.enforceLegacyEmailVerification],
  ));
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ role: result.role, session_id: sessionId })
    .setProtectedHeader({ alg: "HS256", kid: "current" })
    .setSubject(String(result.id))
    .setIssuedAt(now)
    .setExpirationTime(now + (config.sessionLifetimeSeconds ?? 604800))
    .sign(new TextEncoder().encode(config.jwtCurrent));
  return jsonResponse({
    access_token: token,
    token_type: "bearer",
    user: { id: result.id, email: result.email, role: result.role, displayName: result.displayName ?? null },
  }, 200, { "set-cookie": setCookie(token, config), "cache-control": "no-store" });
}

async function logout(request: Request, db: Database, config: AppConfig): Promise<Response> {
  const token = requestToken(request);
  if (token) {
    try {
      const claims = await verifyAppJwt(token, config);
      await rpc(db, "select al_private.al_auth_logout($1::text,$2::text) as payload", [claims.sub, claims.session_id]);
    } catch {
      // Stable logout is forgiving and only revokes the referenced app session.
    }
  }
  return jsonResponse({ status: "success" }, 200, { "set-cookie": clearCookie(config), "cache-control": "no-store" });
}

export async function handleAccountSecurityRoute(
  request: Request,
  db: Database,
  config: AppConfig,
): Promise<Response | null> {
  const rawPath = new URL(request.url).pathname.replace(/^\/functions\/v1\/api/, "");
  const path = rawPath === "/api" || rawPath.startsWith("/api/") ? rawPath : `/api${rawPath}`;
  const loginPath = path === "/api/auth/login";
  const logoutPath = path === "/api/auth/logout";
  const known = loginPath || logoutPath || path === "/api/auth/me" || path === "/api/auth/profile" ||
    path === "/api/account/access" || path === "/api/auth/coach-code" ||
    path === "/api/auth/link" || path === "/api/auth/link-athlete" ||
    /^\/api\/auth\/link\/[^/]+$/.test(path) ||
    path === "/api/coach/roster" || path === "/api/coach/roster/history" ||
    /^\/api\/coach\/roster\/history\/[^/]+$/.test(path) || path === "/api/coach/push-program" ||
    path === "/api/security/devices" || /^\/api\/security\/devices\/[^/]+$/.test(path) ||
    path === "/api/security/sessions" || /^\/api\/security\/sessions\/[^/]+$/.test(path) ||
    path === "/api/security/audit-events";
  if (!known) return null;
  enforceBrowserWriteOrigin(request, config);

  const expected = new Map<string, string[]>([
    ["/api/auth/login", ["POST"]], ["/api/auth/logout", ["POST"]],
    ["/api/auth/me", ["GET"]], ["/api/auth/profile", ["PATCH"]],
    ["/api/account/access", ["GET"]], ["/api/auth/coach-code", ["GET", "POST"]],
    ["/api/auth/link", ["POST", "DELETE"]], ["/api/auth/link-athlete", ["POST"]],
    ["/api/coach/roster", ["GET"]], ["/api/coach/roster/history", ["GET"]],
    ["/api/coach/push-program", ["POST"]], ["/api/security/devices", ["GET"]],
    ["/api/security/sessions", ["GET"]], ["/api/security/audit-events", ["GET"]],
  ]);
  const dynamicMethods = /^\/api\/auth\/link\/[^/]+$/.test(path)
    ? ["DELETE"]
    : /^\/api\/coach\/roster\/history\/[^/]+$/.test(path)
    ? ["GET"]
    : /^\/api\/security\/(?:devices|sessions)\/[^/]+$/.test(path)
    ? ["DELETE"]
    : undefined;
  const allowedMethods = expected.get(path) ?? dynamicMethods;
  if (allowedMethods && !allowedMethods.includes(request.method)) {
    throw new ApiError(405, "Method not allowed");
  }

  let response: Response;
  if (loginPath) {
    if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
    response = await login(request, db, config);
  } else if (logoutPath) {
    if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
    response = await logout(request, db, config);
  } else {
    const principal = await authenticated(request, db, config);
    // Route-specific implementations are added below as narrow private RPCs.
    response = await handleAuthenticatedAccountRoute(request, path, principal, db, config);
  }
  response.headers.set("cache-control", "no-store");
  response.headers.set("pragma", "no-cache");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

async function handleAuthenticatedAccountRoute(
  request: Request,
  path: string,
  principal: Principal,
  db: Database,
  config: AppConfig,
): Promise<Response> {
  const actor = principal.user.id;
  const sid = principal.sessionId;
  const method = request.method;
  const enforce = config.enforceLegacyEmailVerification;
  if (path === "/api/auth/me" && method === "GET") {
    const result = sqlJson(await rpc(db,
      "select al_private.al_auth_me($1::text,$2::text,$3::boolean) as payload",
      [actor, sid, enforce],
    ));
    const user = userJson(principal.user);
    const expiresAt = String(result.sessionExpiresAt);
    const scopes = Array.isArray(result.scopes) ? result.scopes.map(String) : [actor];
    return jsonResponse({ user, sessionExpiresAt: expiresAt,
      offlineGrant: await offlineGrant(db, config, user, sid, expiresAt, scopes), scopes });
  }
  if (path === "/api/auth/profile" && method === "PATCH") {
    const body = await jsonBody(request);
    if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== "string") {
      routeError(422, [{ loc: ["body", "displayName"], msg: "Input should be a valid string", type: "string_type" }]);
    }
    const name = String(body.displayName ?? "").trim();
    if ([...name].length > 80) routeError(422, "Display name must be 80 characters or fewer");
    const result = sqlJson(await rpc(db,
      "select al_private.al_auth_profile($1::text,$2::text,$3::text,$4::boolean) as payload",
      [actor, sid, name || null, enforce],
    ));
    return jsonResponse(result.profile as Json);
  }
  if (method === "GET" && path === "/api/account/access") {
    const result = sqlJson(await rpc(db,
      "select al_private.al_account_access_state($1::text,$2::text,$3::boolean,$4::integer) as payload",
      [actor, sid, enforce, config.analyticsPastDueGraceDays],
    ));
    delete result.denial;
    return jsonResponse(result);
  }

  if (path === "/api/auth/coach-code" && method === "GET") {
    const result = sqlJson(await rpc(db,
      "select al_private.al_coach_code_status($1::text,$2::text,$3::boolean) as payload",
      [actor, sid, enforce],
    ));
    delete result.denial;
    return jsonResponse(result);
  }
  if (path === "/api/auth/coach-code" && method === "POST") {
    const bytes = crypto.getRandomValues(new Uint8Array(3));
    const code = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
    const codeHash = await sha256Hex(code);
    const result = sqlJson(await rpc(db,
      "select al_private.al_coach_code_create($1::text,$2::text,$3::text,$4::text,$5::boolean,$6::integer) as payload",
      [actor, sid, codeHash, crypto.randomUUID(), enforce, config.analyticsPastDueGraceDays],
    ));
    return jsonResponse({ code, expires_at: result.expiresAt });
  }
  if ((path === "/api/auth/link" || path === "/api/auth/link-athlete") && method === "POST") {
    const body = await jsonBody(request);
    if (typeof body.code !== "string") {
      routeError(422, [{ loc: ["body", "code"], msg: "Field required", type: "missing" }]);
    }
    const codeHash = await sha256Hex(body.code.trim().toUpperCase());
    const result = sqlJson(await rpc(db,
      "select al_private.al_athlete_link($1::text,$2::text,$3::text,$4::boolean,$5::integer) as payload",
      [actor, sid, codeHash, enforce, config.analyticsPastDueGraceDays],
    ));
    delete result.denial;
    return jsonResponse(result);
  }
  if (path === "/api/auth/link" && method === "DELETE") {
    const result = sqlJson(await rpc(db,
      "select al_private.al_coaching_unlink($1::text,$2::text,null::text,$3::boolean) as payload",
      [actor, sid, enforce],
    ));
    delete result.denial;
    return jsonResponse(result);
  }
  const coachUnlink = /^\/api\/auth\/link\/([^/]+)$/.exec(path);
  if (coachUnlink && method === "DELETE") {
    let athleteId: string;
    try { athleteId = decodeURIComponent(coachUnlink[1]); } catch { routeError(404, "No active coaching link"); }
    const result = sqlJson(await rpc(db,
      "select al_private.al_coaching_unlink($1::text,$2::text,$3::text,$4::boolean) as payload",
      [actor, sid, athleteId, enforce],
    ));
    delete result.denial;
    return jsonResponse(result);
  }
  if (path === "/api/coach/roster" && method === "GET") {
    const result = sqlJson(await rpc(db,
      "select al_private.al_coach_roster($1::text,$2::text,$3::boolean) as payload",
      [actor, sid, enforce],
    ));
    return jsonResponse(result.rows ?? []);
  }
  if (path === "/api/coach/roster/history" && method === "GET") {
    const result = sqlJson(await rpc(db,
      "select al_private.al_coach_history($1::text,$2::text,$3::boolean) as payload",
      [actor, sid, enforce],
    ));
    return jsonResponse(result.rows ?? []);
  }
  const historyMatch = /^\/api\/coach\/roster\/history\/([^/]+)$/.exec(path);
  if (historyMatch && method === "GET") {
    const rawId = decodeURIComponent(historyMatch[1]);
    if (!/^\d+$/.test(rawId)) routeError(422, [{ loc: ["path", "relationship_id"], msg: "Input should be a valid integer", type: "int_parsing" }]);
    const result = sqlJson(await rpc(db,
      "select al_private.al_coach_history_snapshot($1::text,$2::text,$3::integer,$4::boolean) as payload",
      [actor, sid, Number(rawId), enforce],
    ));
    return jsonResponse(result.snapshot as Json);
  }
  if (path === "/api/coach/push-program" && method === "POST") {
    const body = await jsonBody(request);
    if (typeof body.athleteId !== "string" || typeof body.template !== "string") {
      routeError(422, [
        ...(typeof body.athleteId !== "string" ? [{ loc: ["body", "athleteId"], msg: "Field required", type: "missing" }] : []),
        ...(typeof body.template !== "string" ? [{ loc: ["body", "template"], msg: "Field required", type: "missing" }] : []),
      ]);
    }
    sqlJson(await rpc(db,
      "select al_private.al_coach_push_program($1::text,$2::text,$3::text,$4::boolean,$5::integer) as payload",
      [actor, sid, body.athleteId, enforce, config.analyticsPastDueGraceDays],
    ));
    return jsonResponse({ status: "success",
      message: "Push acknowledged. Create sessions on the athlete plan — demo programs are not auto-injected.",
      athleteId: body.athleteId, template: body.template });
  }
  if (path === "/api/security/devices" && method === "GET") {
    const result = sqlJson(await rpc(db,
      "select al_private.al_security_devices($1::text,$2::text,null::text,$3::text,$4::boolean) as payload",
      [actor, sid, `dev-default-${crypto.randomUUID().slice(0, 8)}`, enforce],
    ));
    return jsonResponse(result.rows ?? []);
  }
  const deviceMatch = /^\/api\/security\/devices\/([^/]+)$/.exec(path);
  if (deviceMatch && method === "DELETE") {
    const deviceId = decodeURIComponent(deviceMatch[1]);
    sqlJson(await rpc(db,
      "select al_private.al_security_devices($1::text,$2::text,$3::text,null::text,$4::boolean) as payload",
      [actor, sid, deviceId, enforce],
    ));
    return jsonResponse({ status: "success" });
  }
  if (path === "/api/security/sessions" && method === "GET") {
    const result = sqlJson(await rpc(db,
      "select al_private.al_security_sessions($1::text,$2::text,null::text,$3::boolean) as payload",
      [actor, sid, enforce],
    ));
    return jsonResponse(result.rows ?? []);
  }
  const sessionMatch = /^\/api\/security\/sessions\/([^/]+)$/.exec(path);
  if (sessionMatch && method === "DELETE") {
    const sessionId = decodeURIComponent(sessionMatch[1]);
    sqlJson(await rpc(db,
      "select al_private.al_security_sessions($1::text,$2::text,$3::text,$4::boolean) as payload",
      [actor, sid, sessionId, enforce],
    ));
    return jsonResponse({ status: "success" });
  }
  if (path === "/api/security/audit-events" && method === "GET") {
    const result = sqlJson(await rpc(db,
      "select al_private.al_security_audit_events($1::text,$2::text,$3::boolean) as payload",
      [actor, sid, enforce],
    ));
    return jsonResponse(result.rows ?? []);
  }
  throw new ApiError(501, "Account route implementation unavailable");
}

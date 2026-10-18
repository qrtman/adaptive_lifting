import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, invalidCredentials, jsonResponse } from "./errors/mod.ts";
import { calculateE1RM, calculateINOL } from "./analytics.ts";
import type { Principal } from "./types/mod.ts";

type JsonObject = Record<string, unknown>;
type RpcPayload = JsonObject & { denial?: string | null };
type ExportRow = {
  ownerId: string;
  date: string;
  exerciseId: string;
  setId: string;
  liftCategory: string;
  tier: string;
  title: string;
  plannedWeight: number | null;
  actual: number | null;
  reps: number | null;
  rpe: number | null;
};

function decodePayload(value: unknown): RpcPayload {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { throw new Error("Day Notes/export RPC returned invalid JSON"); }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Day Notes/export RPC returned an invalid result");
  }
  return value as RpcPayload;
}

function mapDenial(denial: unknown): void {
  switch (denial) {
    case null:
    case undefined:
      return;
    case "invalid_session":
      throw invalidCredentials();
    case "account_ineligible":
      throw new ApiError(403, { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before signing in." });
    case "athlete_forbidden":
      throw new ApiError(403, "Athletes can only access their own plan");
    case "coach_relationship_required":
      throw new ApiError(403, "Not linked to this athlete");
    case "athlete_required":
      throw new ApiError(400, "athlete_id is required for coaches");
    case "unsupported_role":
      throw new ApiError(403, "Not authorized");
    case "invalid_request":
      throw new ApiError(422, "Invalid request");
    default:
      throw new Error("Day Notes/export authorization returned an unknown denial");
  }
}

async function callRpc<T extends JsonObject>(db: Database, query: string, parameters: unknown[]): Promise<T> {
  const client: SqlClient = await db.connect();
  try {
    const result = await client.queryObject<{ payload: unknown }>(query, parameters);
    if (!result.rows[0]) throw new Error("Day Notes/export RPC returned no result");
    return decodePayload(result.rows[0].payload) as T;
  } finally {
    client.release();
  }
}

function validationError(key: string, errorType: string, message: string, input?: unknown): ApiError {
  const detail: JsonObject = { type: errorType, loc: ["body", key], msg: message };
  if (input !== undefined) detail.input = input;
  return new ApiError(422, [detail]);
}

function normalizeDate(value: unknown, bodyInput: JsonObject): string {
  if (typeof value !== "string") throw validationError(
    "date", value === undefined ? "missing" : "string_type",
    value === undefined ? "Field required" : "Input should be a valid string",
    value === undefined ? bodyInput : value,
  );
  const raw = value.trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  if (!match) throw new ApiError(400, "date must be YYYY-MM-DD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCFullYear(year, month - 1, day);
  if (year < 1 || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new ApiError(400, "date must be YYYY-MM-DD");
  }
  return raw;
}

function normalizeBody(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw validationError("body", "string_type", "Input should be a valid string", value);
  const normalized = value.trim();
  if (Array.from(normalized).length > 2000) throw new ApiError(400, "Note must be 2000 characters or fewer");
  return normalized;
}

function optionalAthleteId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw validationError("athleteId", "string_type", "Input should be a valid string", value);
  return value || null;
}

function queryOptional(value: string | null): string | null {
  return value === null || value === "" ? null : value;
}

export async function handleDayNotesRoute(
  request: Request,
  db: Database,
  principal: Principal,
  config: AppConfig,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const athleteId = queryOptional(url.searchParams.get("athlete_id"));
    const payload = await callRpc<RpcPayload>(db,
      "select al_private.al_day_notes_read($1::text,$2::text,$3::text,$4::boolean) as payload",
      [principal.user.id, principal.sessionId, athleteId, config.enforceLegacyEmailVerification]);
    mapDenial(payload.denial);
    const notes = Array.isArray(payload.notes)
      ? payload.notes.filter((note) => !!note && typeof note === "object" &&
        typeof (note as JsonObject).body === "string" && ((note as JsonObject).body as string).trim() !== "")
      : [];
    return jsonResponse({ notes });
  }
  if (request.method !== "PUT") throw new ApiError(405, "Method not allowed");

  let input: unknown;
  try { input = await request.json(); } catch { throw new ApiError(422, "Invalid request body"); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ApiError(422, "Invalid request body");
  const row = input as JsonObject;
  const date = normalizeDate(row.date, row);
  const body = normalizeBody(row.body);
  const athleteId = optionalAthleteId(row.athleteId);
  const newNoteId = `dn-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const payload = await callRpc<RpcPayload>(db,
    "select al_private.al_day_notes_upsert($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::boolean) as payload",
    [principal.user.id, principal.sessionId, athleteId, date, body, newNoteId, config.enforceLegacyEmailVerification]);
  mapDenial(payload.denial);
  if (!payload.note || typeof payload.note !== "object") throw new Error("Day Note write interface returned no note");
  return jsonResponse(payload.note);
}

function numberOrZero(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeTextCell(value: string): string {
  return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function csvCell(value: string | number): string {
  const text = typeof value === "string" ? safeTextCell(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values: Array<string | number>): string {
  return values.map(csvCell).join(",");
}

export function makeCsv(rows: ExportRow[]): string {
  const output = [csvRow([
    "Date", "Lift Category", "Tier", "Exercise Title", "Planned Weight (kg)",
    "Actual Weight (kg)", "Reps", "RPE", "e1RM (kg)", "INOL", "Tonnage (kg)",
  ])];
  for (const row of rows) {
    const plannedWeight = numberOrZero(row.plannedWeight);
    const actualWeight = numberOrZero(row.actual);
    const reps = numberOrZero(row.reps);
    const rpe = numberOrZero(row.rpe);
    const e1rm = calculateE1RM(actualWeight, reps, rpe);
    const intensity = e1rm > 0 ? actualWeight / e1rm * 100 : 0;
    const inol = calculateINOL(reps, intensity);
    const tonnage = actualWeight * reps;
    output.push(csvRow([
      row.date,
      row.liftCategory || "Squat",
      row.tier || "Comp",
      row.title,
      plannedWeight > 0 ? plannedWeight : row.plannedWeight || "—",
      actualWeight > 0 ? actualWeight : row.actual || "—",
      reps > 0 ? reps : "—",
      rpe > 0 ? rpe : "—",
      e1rm > 0 ? Number(e1rm.toFixed(1)) : "—",
      inol > 0 ? Number(inol.toFixed(2)) : "—",
      tonnage > 0 ? Number(tonnage.toFixed(1)) : "—",
    ]));
  }
  return `${output.join("\r\n")}\r\n`;
}

export async function handleExportRoute(
  request: Request,
  db: Database,
  principal: Principal,
  config: AppConfig,
  path: string,
): Promise<Response> {
  if (request.method !== "GET") throw new ApiError(405, "Method not allowed");
  if (path === "/api/export/json") {
    const payload = await callRpc<RpcPayload>(db,
      "select al_private.al_export_json($1::text,$2::text,$3::boolean) as payload",
      [principal.user.id, principal.sessionId, config.enforceLegacyEmailVerification]);
    mapDenial(payload.denial);
    const microcycles = Array.isArray(payload.microcycles) ? payload.microcycles : [];
    return new Response(JSON.stringify(microcycles, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": "attachment; filename=adaptive_lifting_export.json",
      },
    });
  }
  if (path !== "/api/export/csv") throw new ApiError(404, "Not found");
  const url = new URL(request.url);
  const liftCategory = url.searchParams.get("lift_category");
  const tier = url.searchParams.get("tier");
  const payload = await callRpc<RpcPayload>(db,
    "select al_private.al_export_csv_rows($1::text,$2::text,$3::text,$4::text,$5::boolean) as payload",
    [principal.user.id, principal.sessionId, liftCategory, tier, config.enforceLegacyEmailVerification]);
  mapDenial(payload.denial);
  const rows = Array.isArray(payload.rows) ? payload.rows as ExportRow[] : [];
  const csv = makeCsv(rows);
  const ownerIds = [...new Set(rows.map((row) => row.ownerId).filter((id) => typeof id === "string"))];
  const audit = await callRpc<RpcPayload>(db,
    "select al_private.al_export_csv_audit($1::text,$2::text,$3::text[],$4::integer,$5::text,$6::text,$7::boolean) as payload",
    [principal.user.id, principal.sessionId, ownerIds, rows.length, liftCategory, tier, config.enforceLegacyEmailVerification]);
  mapDenial(audit.denial);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename=adaptive_lifting_export.csv",
    },
  });
}

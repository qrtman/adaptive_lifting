import type { AppConfig } from "./config.ts";
import type { Database } from "./db/mod.ts";
import { ApiError, invalidCredentials } from "./errors/mod.ts";
import {
  buildAnalyticsResult,
  resolveAnalyticsRange,
  resolveAnalyticsSecondaryRange,
  validateAnalyticsConfig,
  filterAnalyticsRows,
  type AnalyticsConfig,
  type AnalyticsFacts,
  type AnalyticsRow,
} from "./analytics.ts";
import type { Principal } from "./types/mod.ts";

interface RpcEnvelope extends AnalyticsFacts { denial: string | null }

async function readFacts(
  db: Database,
  principal: Principal,
  athleteId: string,
  start: string,
  end: string,
  includeAcwr: boolean,
  config: AppConfig,
): Promise<AnalyticsFacts> {
  const client = await db.connect();
  try {
    const result = await client.queryObject<{ payload: RpcEnvelope }>(
      `select public.al_analytics_read_facts(
        $1::text, $2::text, $3::text, $4::date, $5::date, $6::boolean,
        $7::boolean, $8::integer
      ) as payload`,
      [
        principal.user.id,
        principal.sessionId,
        athleteId,
        start,
        end,
        includeAcwr,
        config.enforceLegacyEmailVerification,
        config.analyticsPastDueGraceDays,
      ],
    );
    const payload = result.rows[0]?.payload;
    if (!payload) throw new Error("Analytics database interface returned no result");
    switch (payload.denial) {
      case "invalid_session": throw invalidCredentials();
      case "account_ineligible":
        throw new ApiError(403, {
          code: "EMAIL_VERIFICATION_REQUIRED",
          message: "Verify your email before signing in.",
        });
      case "coach_relationship_required":
        throw new ApiError(403, "Not authorized to view this athlete");
      case "athlete_forbidden":
        throw new ApiError(403, "Not authorized to view other athletes");
      case "workspace_access_required":
        throw new ApiError(403, {
          code: "WORKSPACE_ACCESS_REQUIRED",
          message: "An active coaching plan is required.",
        });
      case "invalid_request": throw new ApiError(422, "Invalid range");
      case "unsupported_role": throw new ApiError(403, "Not authorized");
      case null: return { set_rows: payload.set_rows ?? [], acwr_rows: payload.acwr_rows ?? [] };
      default: throw new Error("Analytics database interface rejected the request");
    }
  } finally {
    client.release();
  }
}

export async function handleAnalyticsQuery(
  request: Request,
  config: AppConfig,
  db: Database,
  principal: Principal,
): Promise<Record<string, unknown>> {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid body");
    body = parsed as Record<string, unknown>;
  } catch {
    throw new ApiError(422, "Invalid request body");
  }
  const queryConfig = validateAnalyticsConfig(body.config) as AnalyticsConfig;
  if (body.athlete_id !== undefined && body.athlete_id !== null && typeof body.athlete_id !== "string") {
    throw new ApiError(422, "Invalid athlete_id");
  }
  const athleteId = typeof body.athlete_id === "string" ? body.athlete_id : principal.user.id;
  const today = new Date().toISOString().slice(0, 10);
  const primary = resolveAnalyticsRange(queryConfig, today);
  const includeAcwr = queryConfig.metrics.includes("acwr");
  const primaryFacts = await readFacts(db, principal, athleteId, primary.start, primary.end, includeAcwr, config);
  const primaryRows: AnalyticsRow[] = filterAnalyticsRows(primaryFacts.set_rows, primary.start, primary.end, queryConfig.scopes ?? []);
  let secondaryFacts: AnalyticsFacts | null = null;
  if (queryConfig.comparison?.kind === "period_vs_period" && queryConfig.comparison.secondary) {
    const secondary = resolveAnalyticsSecondaryRange(primary, queryConfig.comparison.secondary, primaryRows);
    secondaryFacts = await readFacts(db, principal, athleteId, secondary.start, secondary.end, includeAcwr, config);
  }
  return buildAnalyticsResult(queryConfig, primaryFacts, secondaryFacts, today);
}

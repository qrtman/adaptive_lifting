import {
  handleInsightCardSync,
  parseInsightCardSyncPayload,
  validateInsightCardSyncConfigs,
} from "../functions/_shared/insightCardSyncRoute.ts";
import { ApiError } from "../functions/_shared/errors/mod.ts";
import { MATH_VERSION } from "../functions/_shared/analytics.ts";

const change = (fields: Record<string, unknown> = {}) => ({
  entity: "InsightCard",
  id: "card-1",
  mutation_id: "mut-1",
  updated_at: "2026-09-14T00:00:00Z",
  fields,
});

Deno.test("modern insight_card payload omits workout_id", () => {
  const parsed = parseInsightCardSyncPayload({
    schema_version: 1,
    mutation_type: "insight_card",
    client_device_id: "dev-example",
    last_updated_at: "2026-09-14T00:00:00Z",
    math_version: "linear-decay-v3",
    changes: [change()],
  });
  if (parsed.mutation_type !== "insight_card" || parsed.workout_id !== undefined) {
    throw new Error("Modern payload did not preserve its contract");
  }
});

Deno.test("legacy insight-cards sentinel and arbitrary integer schema version are accepted", () => {
  const parsed = parseInsightCardSyncPayload({
    schema_version: 7,
    client_device_id: "dev-example",
    workout_id: "insight-cards",
    last_updated_at: "2026-09-14T00:00:00Z",
    changes: [change()],
  });
  if (parsed.mutation_type !== "workout" || parsed.schema_version !== 7 ||
      parsed.workout_id !== "insight-cards" || parsed.math_version !== undefined) {
    throw new Error("Legacy sentinel payload was rejected or rewritten");
  }
});

Deno.test("default workout mutation without workout_id remains invalid", () => {
  let failed = false;
  try {
    parseInsightCardSyncPayload({
      schema_version: 1,
      client_device_id: "dev-example",
      last_updated_at: "2026-09-14T00:00:00Z",
      changes: [],
    });
  } catch { failed = true; }
  if (!failed) throw new Error("Missing legacy-required workout_id was accepted");
});

Deno.test("empty config skips CardConfig validation but incompatible config is per-mutation rejected", () => {
  const empty = parseInsightCardSyncPayload({
    schema_version: 1, mutation_type: "insight_card", client_device_id: "d",
    last_updated_at: "now", changes: [change({ config: {} })],
  });
  validateInsightCardSyncConfigs(empty);
  if (empty.changes[0]._compatibility_rejected) throw new Error("Falsy config was validated");

  const incompatible = parseInsightCardSyncPayload({
    schema_version: 1, mutation_type: "insight_card", client_device_id: "d",
    last_updated_at: "now", changes: [change({ config: {
      metrics: ["e1rm", "set_count"],
      range: { start: "2026-09-01", end: "2026-09-07" },
    } })],
  });
  validateInsightCardSyncConfigs(incompatible);
  if (!incompatible.changes[0]._compatibility_rejected) {
    throw new Error("Incompatible config was not marked for rejection");
  }
});

Deno.test("malformed config is deferred so mutation idempotency is checked first", () => {
  const malformed = parseInsightCardSyncPayload({
    schema_version: 1, mutation_type: "insight_card", client_device_id: "d",
    last_updated_at: "now", changes: [change({ config: { metrics: [] } })],
  });
  validateInsightCardSyncConfigs(malformed);
  if (!malformed.changes[0]._schema_error) {
    throw new Error("Malformed config was not deferred for transactional validation");
  }
});

Deno.test("absent and matching math versions proceed; mismatch preserves the 409 body", async () => {
  const db = {
    async connect() {
      return {
        async queryObject() {
          return { rows: [{ payload: {
            denial: null,
            accepted_mutation_ids: [],
            rejected_mutation_ids: [],
            canonical: [],
          } }] };
        },
        release() {},
      };
    },
  } as never;
  const principal = { user: { id: "stg-user" }, sessionId: "stg-session" } as never;
  for (const extra of [{}, { math_version: MATH_VERSION }]) {
    const response = await handleInsightCardSync(new Request("https://local/api/insight-cards/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schema_version: 1,
        mutation_type: "insight_card",
        client_device_id: "dev-test",
        last_updated_at: "2026-09-14T00:00:00Z",
        changes: [],
        ...extra,
      }),
    }), db, principal);
    if (response.status !== 200) throw new Error("Absent/matching math version was rejected");
  }
  try {
    await handleInsightCardSync(new Request("https://local/api/insight-cards/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schema_version: 99,
        mutation_type: "insight_card",
        client_device_id: "dev-test",
        last_updated_at: "2026-09-14T00:00:00Z",
        math_version: "different-version",
        changes: [],
      }),
    }), db, principal);
    throw new Error("Mismatched math version was accepted");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 409) throw error;
    const detail = error.detail as { error?: { code?: string; message?: string; details?: { server?: string; client?: string } } };
    if (detail.error?.code !== "MATH_VERSION_MISMATCH" ||
        detail.error.message !== "Client math version does not match the server. App update required." ||
        detail.error.details?.server !== MATH_VERSION ||
        detail.error.details.client !== "different-version") {
      throw new Error("MATH_VERSION_MISMATCH response changed");
    }
  }
});

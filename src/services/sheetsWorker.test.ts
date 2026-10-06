import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../supabase/functions/_shared/config.ts";
import { handleGoogleSheetsWorker } from "../../supabase/functions/_shared/sheetsWorker.ts";
import { integrationFernetKey } from "../../supabase/functions/_shared/integrationCrypto.ts";
import { fernetEncrypt, fernetDecrypt } from "../../supabase/functions/_shared/fernet.ts";

const internalSecret = "controlled-worker-test-secret";
const integrationSecret = "controlled-integration-test-key";

class FakeDatabase {
  claimCount = 0;
  statements: Array<{ sql: string; params: unknown[] }> = [];
  jobPayload: Record<string, unknown> = { athlete_id: "athlete-1", mesocycle_id: "mesocycle-1", tabs: ["Sets", "Workouts"] };
  accessExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  refreshCipher: string | null = null;
  begin: Record<string, unknown> = {
    send: true,
    microcycles: [{ workouts: [{ id: "w1", date: "2026-10-01", title: "Session", exercises: [{ title: "Squat", liftCategory: "Squat", tier: "Comp", sets: [{ actual: 100, reps: 3, executedRpe: 8, isTop: true }] }] }] }],
  };
  async queryObject<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    this.statements.push({ sql, params });
    let payload: unknown = {};
    if (sql.includes("al_integration_secret")) return { rows: [{ value: internalSecret } as T] };
    if (sql.includes("al_sheets_worker_claim")) {
      payload = this.claimCount++ === 0 ? {
        jobId: "job-1", attempt: 1, connectionId: "connection-1",
        payload: this.jobPayload,
      } : { jobId: null };
    } else if (sql.includes("al_sheets_worker_begin")) payload = this.begin;
    else if (sql.includes("al_sheets_worker_credentials")) {
      payload = { accessCipher: await fernetEncrypt("google-access-token", await integrationFernetKey(integrationSecret)), accessExpiresAt: this.accessExpiresAt, refreshCipher: this.refreshCipher };
    } else if (sql.includes("al_sheets_worker_finish")) payload = { updated: true };
    return { rows: [{ payload } as T] };
  }
  release() {}
  async connect() { return this; }
}

const config: AppConfig = {
  databaseUrl: "postgres://test",
  jwtCurrent: "test",
  jwtPrevious: null,
  enforceLegacyEmailVerification: false,
  analyticsPastDueGraceDays: 3,
  allowedOrigins: ["https://app.example"],
  googleSheetsClientId: "client-id",
  googleSheetsClientSecret: "client-secret",
  integrationEncryptionKey: integrationSecret,
};

describe("Google Sheets Edge worker", () => {
  it("authorizes privately, claims once, writes canonical batches, and finalizes success", async () => {
    const db = new FakeDatabase();
    const requests: Array<{ url: string; body?: string }> = [];
    const fetcher: typeof fetch = async (input, init: RequestInit = {}) => {
      const url = String(input);
      requests.push({ url, body: typeof init.body === "string" ? init.body : undefined });
      if (url.endsWith("/v4/spreadsheets")) return Response.json({ spreadsheetId: "sheet-1" });
      if (url.includes("?fields=sheets.properties")) return Response.json({ sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }] });
      return new Response("{}", { status: 200 });
    };
    const response = await handleGoogleSheetsWorker(
      new Request("https://edge.example/google-sheets-worker", { method: "POST", headers: { authorization: `Bearer ${internalSecret}` }, body: "{}" }),
      db as never,
      { ...config, fetcher },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ claimed: 1, success: 1, failed: 0 });
    expect(requests.map((request) => request.url)).toEqual(expect.arrayContaining([
      "https://sheets.googleapis.com/v4/spreadsheets",
      expect.stringContaining("/values:batchUpdate"),
    ]));
    const finish = db.statements.find(({ sql }) => sql.includes("al_sheets_worker_finish"));
    expect(finish?.params.slice(0, 4)).toEqual(["job-1", expect.any(String), true, "https://docs.google.com/spreadsheets/d/sheet-1"]);
    expect(db.statements.some(({ sql }) => sql.includes("pg_advisory_unlock"))).toBe(true);
    const checkpoints = db.statements.filter(({ sql }) => sql.includes("al_sheets_worker_checkpoint"));
    expect(checkpoints).toHaveLength(2);
    expect(JSON.parse(String(checkpoints[0].params[2]))._spreadsheet_create_started).toBe(true);
    expect(JSON.parse(String(checkpoints[1].params[2]))._spreadsheet_id).toBe("sheet-1");
  });

  it("rejects non-internal callers before claiming jobs or contacting Google", async () => {
    const db = new FakeDatabase();
    let fetches = 0;
    await expect(handleGoogleSheetsWorker(
      new Request("https://edge.example/google-sheets-worker", { method: "POST", body: "{}" }),
      db as never,
      { ...config, fetcher: async () => { fetches++; return new Response(); } },
    )).rejects.toMatchObject({ status: 401 });
    expect(db.claimCount).toBe(0);
    expect(fetches).toBe(0);
  });

  it("does not contact Google when execution-time authorization has been revoked", async () => {
    const db = new FakeDatabase();
    db.begin = { send: false, reason: "authorization" };
    let fetches = 0;
    const response = await handleGoogleSheetsWorker(
      new Request("https://edge.example/google-sheets-worker", { method: "POST", headers: { authorization: `Bearer ${internalSecret}` }, body: "{}" }),
      db as never,
      { ...config, fetcher: async () => { fetches++; return new Response(); } },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ claimed: 1, success: 0, failed: 0 });
    expect(fetches).toBe(0);
    expect(db.statements.some(({ sql }) => sql.includes("al_sheets_worker_credentials"))).toBe(false);
    expect(db.statements.some(({ sql, params }) => sql.includes("al_sheets_worker_finish") && params[2] === false)).toBe(true);
    expect(db.statements.some(({ sql }) => sql.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("resumes a checkpointed spreadsheet without creating another", async () => {
    const db = new FakeDatabase();
    db.jobPayload = { ...db.jobPayload, _spreadsheet_id: "existing-sheet" };
    const urls: string[] = [];
    const response = await handleGoogleSheetsWorker(
      new Request("https://edge.example/google-sheets-worker", { method: "POST", headers: { authorization: `Bearer ${internalSecret}` }, body: "{}" }),
      db as never,
      { ...config, fetcher: async (input) => { const url = String(input); urls.push(url); return url.includes("?fields=sheets.properties") ? Response.json({ sheets: [] }) : new Response("{}", { status: 200 }); } },
    );
    expect(response.status).toBe(200);
    expect(urls.some((url) => url.endsWith("/v4/spreadsheets"))).toBe(false);
    expect(urls.some((url) => url.includes("/spreadsheets/existing-sheet"))).toBe(true);
  });

  it("stops after an uncertain spreadsheet creation instead of retrying create", async () => {
    const db = new FakeDatabase();
    db.jobPayload = { ...db.jobPayload, _spreadsheet_create_started: true };
    const urls: string[] = [];
    await handleGoogleSheetsWorker(
      new Request("https://edge.example/google-sheets-worker", { method: "POST", headers: { authorization: `Bearer ${internalSecret}` }, body: "{}" }),
      db as never,
      { ...config, fetcher: async (input) => { urls.push(String(input)); return new Response("{}", { status: 200 }); } },
    );
    expect(urls.some((url) => url.endsWith("/v4/spreadsheets"))).toBe(false);
    const finish = db.statements.find(({ sql }) => sql.includes("al_sheets_worker_finish"));
    expect(finish?.params[3]).toContain("automatic retry stopped");
  });

  it("refreshes an expiring access token and persists only encrypted credentials", async () => {
    const db = new FakeDatabase();
    db.accessExpiresAt = new Date(Date.now() - 1_000).toISOString();
    db.refreshCipher = await fernetEncrypt("google-refresh-token", await integrationFernetKey(integrationSecret));
    const urls: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "new-google-access", expires_in: 3600 });
      if (url.includes("?fields=sheets.properties")) return Response.json({ sheets: [{ properties: { sheetId: 0, title: "Sheet1" } }] });
      if (url.endsWith("/v4/spreadsheets")) return Response.json({ spreadsheetId: "sheet-1" });
      return new Response("{}", { status: 200 });
    };
    await handleGoogleSheetsWorker(
      new Request("https://edge.example/google-sheets-worker", { method: "POST", headers: { authorization: `Bearer ${internalSecret}` }, body: "{}" }),
      db as never,
      { ...config, fetcher },
    );
    expect(urls).toContain("https://oauth2.googleapis.com/token");
    const finish = db.statements.find(({ sql }) => sql.includes("al_sheets_worker_finish"));
    const accessCipher = String(finish?.params[5]);
    expect(accessCipher).not.toContain("new-google-access");
    await expect(fernetDecrypt(accessCipher, await integrationFernetKey(integrationSecret))).resolves.toBe("new-google-access");
    expect(finish?.params[7]).toBeNull();
  });
});

it("encrypts integration credentials with an independent Fernet-compatible key", async () => {
  const key = await integrationFernetKey(integrationSecret);
  const ciphertext = await fernetEncrypt("refresh-token", key);
  expect(ciphertext).not.toContain("refresh-token");
  await expect(fernetDecrypt(ciphertext, key)).resolves.toBe("refresh-token");
  const tampered = `${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}`;
  await expect(fernetDecrypt(tampered, key)).rejects.toThrow();
});

// Bundled on the hosted runner, then executed only inside the network-denied
// synthetic PostgreSQL container. Unix socket transport is not TLS evidence.
import { Client, Pool } from "@db/postgres";
import { MAINTENANCE_KEY, createMaintenanceHandler, withRequestMaintenanceGate,
  type MaintenanceClient } from "./maintenance.ts";

const format = "adaptive-native-maintenance-fixture-v1";
const config = { hostname: "/tmp", host_type: "socket" as const,
  database: "postgres", port: 5432, connection: { attempts: 0 } };
const pool = new Pool({ ...config, user: "maintenance_fixture_writer" }, 1, true);
const control = new Client({ ...config, user: "postgres" });
let native: MaintenanceClient | undefined;
const db = { async connect() { native = await pool.connect(); return native; } };
const checks = { sharedSessionAcrossHelpers: false, sharedSessionAcrossProviderGap: false,
  exclusiveRejectsBeforeCallback: false, terminatedSessionRejectsWrites: false,
  driverReconnectDisabled: false, freshRequestReadmitted: false, cleanup: false };
let stage = "connect";
let failed = false;
const require = (value: boolean) => { if (!value) throw new Error("Synthetic assertion failed"); };
async function exclusive(acquire: boolean): Promise<boolean> {
  const operation = acquire ? "pg_try_advisory_lock" : "pg_advisory_unlock";
  const result = await control.queryObject<{ ok: boolean }>(
    `select pg_catalog.${operation}($1::integer,$2::integer) as ok`, [...MAINTENANCE_KEY]);
  require(result.rows.length === 1 && typeof result.rows[0].ok === "boolean");
  return result.rows[0].ok;
}

try {
  await control.connect();
  stage = "request-shared";
  await withRequestMaintenanceGate(db, async borrowed => {
    const first = await borrowed.connect();
    const before = await first.queryObject<{ pid: number }>("select pg_backend_pid() as pid");
    first.release();
    require(await exclusive(true) === false);
    checks.sharedSessionAcrossHelpers = true;
    // Synthetic provider gap: after releasing the first SQL view, ownership
    // must remain while the handler has no borrowed SQL view in use.
    await new Promise(resolve => setTimeout(resolve, 20));
    require(await exclusive(true) === false);
    const second = await borrowed.connect();
    const after = await second.queryObject<{ pid: number }>("select pg_backend_pid() as pid");
    require(before.rows[0].pid === after.rows[0].pid);
    second.release();
    checks.sharedSessionAcrossProviderGap = true;
  });

  stage = "exclusive-denial";
  require(await exclusive(true));
  let called = false;
  const handler = createMaintenanceHandler(db, () => async () => {
    called = true; return new Response("Synthetic callback must not execute");
  }, []);
  const denied = await handler(new Request("https://fixture.invalid/api/workouts"));
  require(denied.status === 503 && denied.headers.get("retry-after") === "5" && !called);
  checks.exclusiveRejectsBeforeCallback = true;
  require(await exclusive(false));

  stage = "terminated-backend";
  let gateRejected = false;
  try {
    await withRequestMaintenanceGate(db, async borrowed => {
      const sql = await borrowed.connect();
      const admitted = await sql.queryObject<{ pid: number }>("select pg_backend_pid() as pid");
      const killed = await control.queryObject<{ ok: boolean }>(
        "select pg_terminate_backend($1::integer) as ok", [admitted.rows[0].pid]);
      require(killed.rows[0].ok === true);
      let firstRejected = false;
      try { await sql.queryObject("insert into maintenance_fixture.rows values (92)"); }
      catch { firstRejected = true; }
      require(firstRejected);
      let secondRejected = false;
      try { await sql.queryObject("insert into maintenance_fixture.rows values (93)"); }
      catch { secondRejected = true; }
      require(secondRejected);
      let rawRejected = false;
      try { await native!.queryObject("select 1"); } catch { rawRejected = true; }
      require(rawRejected);
      checks.driverReconnectDisabled = true;
      sql.release();
    });
  } catch { gateRejected = true; }
  require(gateRejected && checks.driverReconnectDisabled);
  const written = await control.queryObject<{ count: number }>(
    "select count(*)::integer as count from maintenance_fixture.rows where id in (92,93)");
  require(written.rows[0].count === 0);
  checks.terminatedSessionRejectsWrites = true;

  stage = "fresh-request";
  await withRequestMaintenanceGate(db, async borrowed => {
    const sql = await borrowed.connect();
    const result = await sql.queryObject<{ ok: number }>("select 1::integer as ok");
    require(result.rows[0].ok === 1); sql.release();
  });
  checks.freshRequestReadmitted = true;
} catch { failed = true; }
finally {
  let closed = true;
  try { await pool.end(); } catch { closed = false; }
  try { await control.end(); } catch { closed = false; }
  checks.cleanup = closed;
}
if (!Object.values(checks).every(value => value === true)) failed = true;
console.log(JSON.stringify({ format, status: failed ? "failed" : "verified",
  ...(failed ? { failedStage: stage } : {}), checks,
  fixtureTransport: "unix-socket", productionTls: "NOT TESTED", captureAllowed: false }));

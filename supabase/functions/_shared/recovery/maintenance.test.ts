import { assertEquals, assertRejects } from "@std/assert";
import { ApiError } from "../errors/mod.ts";
import { createMaintenanceHandler, withRequestMaintenanceGate, type MaintenanceClient } from "./maintenance.ts";
import type { Database, SqlClient } from "../db/mod.ts";

function fixture({ denied = false, unlock = true, acquireFails = false, closeFails = false } = {}) {
  const calls: string[] = [];
  const client: MaintenanceClient = { connected: true, session: { pid: 123 },
    async queryObject<T>(sql: string) {
      calls.push(sql);
      if (sql.includes("pg_try_advisory")) {
        if (acquireFails) throw new Error("private-native-detail");
        return { rows: [{ acquired: !denied }] as T[] };
      }
      if (sql.includes("pg_advisory_unlock")) return { rows: [{ released: unlock }] as T[] };
      return { rows: [{ ok: true }] as T[] };
    }, release() { calls.push("pool-release"); },
    end() { calls.push("end"); return closeFails ? Promise.reject(Error("private-close")) : Promise.resolve(); },
  };
  let connections = 0;
  const db = { connect: () => { connections++; return Promise.resolve(client); } };
  return { client, calls, db, connections: () => connections };
}

Deno.test("whole request shares one session across RPC releases and provider work without pool-size-one deadlock", async () => {
  const f = fixture();
  await withRequestMaintenanceGate(f.db, async borrowed => {
    const first = await borrowed.connect(); await first.queryObject("first RPC"); first.release();
    assertEquals(f.calls.includes("pool-release"), false);
    await Promise.resolve(); // provider/network work between separate RPC helpers
    assertEquals(f.calls.some(sql => sql.includes("pg_advisory_unlock")), false);
    const second = await borrowed.connect(); await second.queryObject("final RPC"); second.release();
  });
  assertEquals(f.connections(), 1);
  assertEquals(f.calls.at(-1), "pool-release");
  assertEquals(f.calls.filter(sql => sql.includes("pg_advisory_unlock")).length, 1);
});

Deno.test("exclusive maintenance rejects before mutation/provider work with 503 and retry metadata", async () => {
  const f = fixture({ denied: true }); let invoked = false;
  const handler = createMaintenanceHandler(f.db, () => async () => { invoked = true; return new Response(); }, ["https://app.test"]);
  const response = await handler(new Request("https://app.test/api/sets/log", { headers: { origin: "https://app.test" } }));
  assertEquals(response.status, 503); assertEquals(response.headers.get("retry-after"), "5");
  assertEquals(response.headers.get("access-control-allow-origin"), "https://app.test");
  assertEquals(invoked, false); assertEquals(f.calls.at(-1), "pool-release");
});

Deno.test("unknown acquire and lost unlock require close before any pool return; uncertain close is quarantined", async () => {
  for (const change of [{ acquireFails: true }, { unlock: false }, { unlock: false, closeFails: true }]) {
    const f = fixture(change);
    await assertRejects(() => withRequestMaintenanceGate(f.db, () => Promise.resolve()), ApiError);
    assertEquals(f.calls.includes("end"), true);
    assertEquals(f.calls.includes("pool-release"), change.closeFails !== true);
    if (change.closeFails !== true) assertEquals(f.calls.at(-2), "end");
  }
});

Deno.test("borrowed clients reject queries after consumer release, request completion, and session loss", async () => {
  const f = fixture(); let saved: SqlClient | undefined; let savedDb: Database | undefined;
  await assertRejects(() => withRequestMaintenanceGate(f.db, async borrowed => {
    savedDb = borrowed;
    const released = await borrowed.connect(); released.release();
    await assertRejects(() => released.queryObject("late write"), ApiError);
    saved = await borrowed.connect();
    Object.defineProperty(f.client, "connected", { value: false });
    await assertRejects(() => saved!.queryObject("lost-session write"), ApiError);
  }), ApiError);
  await assertRejects(() => saved!.queryObject("detached write"), ApiError);
  await assertRejects(() => savedDb!.connect(), ApiError);
  assertEquals(f.calls.some(sql => sql.includes("write")), false);
});

Deno.test("origin rejection and valid CORS preflight do not acquire a database session", async () => {
  const f = fixture();
  const rejected = createMaintenanceHandler(f.db, () => async () => new Response(), [], () => { throw new ApiError(403, "Origin denied"); });
  assertEquals((await rejected(new Request("https://app.test/api"))).status, 403);
  const preflight = createMaintenanceHandler(f.db, () => async () => new Response(null, { status: 204 }), ["https://app.test"]);
  assertEquals((await preflight(new Request("https://app.test/api", { method: "OPTIONS", headers: { origin: "https://app.test" } }))).status, 204);
  assertEquals(f.connections(), 0);
});

Deno.test("operation failure preserves ordinary error handling after a confirmed guard release", async () => {
  const f = fixture();
  await assertRejects(() => withRequestMaintenanceGate(f.db, () => Promise.reject(new ApiError(401, "Denied"))), ApiError, "Denied");
  assertEquals(f.calls.at(-1), "pool-release");
});

const short = { connectMs: 10, queryMs: 10, closeMs: 10 };
Deno.test("hung checkout expires and its late client is closed before returning to the pool", async () => {
  const f = fixture(); let resolve!: (client: MaintenanceClient) => void;
  const checkout = new Promise<MaintenanceClient>(done => { resolve = done; });
  await assertRejects(() => withRequestMaintenanceGate({ connect: () => checkout }, () => Promise.resolve(), short), ApiError);
  resolve(f.client); await new Promise(done => setTimeout(done, 0));
  assertEquals(f.calls, ["end", "pool-release"]);
});

Deno.test("hung acquire, unlock and close expire; unknown close never returns to pool", async () => {
  for (const phase of ["acquire", "unlock", "close"]) {
    const f = fixture({ acquireFails: phase === "close" });
    const original = f.client.queryObject.bind(f.client);
    f.client.queryObject = <T>(sql: string) => {
      if ((phase === "acquire" && sql.includes("pg_try_advisory")) ||
          (phase === "unlock" && sql.includes("pg_advisory_unlock"))) return new Promise<{ rows: T[] }>(() => {});
      return original<T>(sql);
    };
    if (phase === "close") f.client.end = () => { f.calls.push("end"); return new Promise(() => {}); };
    await assertRejects(() => withRequestMaintenanceGate(f.db, () => Promise.resolve(), short), ApiError);
    assertEquals(f.calls.includes("end"), true);
    assertEquals(f.calls.includes("pool-release"), phase !== "close");
  }
});

Deno.test("detached SQL drains before the shared guard unlocks", async () => {
  const f = fixture(); let finish!: () => void;
  const original = f.client.queryObject.bind(f.client);
  f.client.queryObject = <T>(sql: string) => sql === "detached" ? new Promise<{ rows: T[] }>(done => {
    finish = () => { f.calls.push("detached-finished"); done({ rows: [] }); };
  }) : original<T>(sql);
  const guarded = withRequestMaintenanceGate(f.db, async borrowed => {
    const client = await borrowed.connect(); void client.queryObject("detached");
  }, { ...short, queryMs: 100 });
  await new Promise(done => setTimeout(done, 0));
  assertEquals(f.calls.some(sql => sql.includes("unlock")), false);
  finish(); await guarded;
  assertEquals(f.calls.indexOf("detached-finished") < f.calls.findIndex(sql => sql.includes("unlock")), true);
});

Deno.test("slow provider callback retains shared ownership until it finishes", async () => {
  const f = fixture(); let finish!: () => void;
  const provider = new Promise<void>(done => { finish = done; });
  const guarded = withRequestMaintenanceGate(f.db, () => provider, short);
  await new Promise(done => setTimeout(done, 30));
  assertEquals(f.calls.some(sql => sql.includes("unlock") || sql === "end" || sql === "pool-release"), false);
  finish(); await guarded;
  assertEquals(f.calls.at(-1), "pool-release");
});

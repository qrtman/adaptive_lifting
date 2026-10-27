import type { Database, SqlClient } from "../db/mod.ts";
import { ApiError, errorResponse } from "../errors/mod.ts";
import protocol from "./maintenance-protocol.json" with { type: "json" };

export const MAINTENANCE_KEY = Object.freeze([protocol.namespace, protocol.key]);
export const MAINTENANCE_PROTOCOL = protocol.version;
const unavailable = () => new ApiError(503, "Recovery maintenance is in progress; retry shortly", {
  "Retry-After": "5", "Cache-Control": "no-store",
});

export interface MaintenanceClient extends SqlClient {
  readonly connected: boolean;
  readonly session: { pid: number | undefined };
  end(): Promise<void>;
}
export interface MaintenanceDatabase {
  connect(): Promise<MaintenanceClient>;
}

interface Deadlines { connectMs?: number; queryMs?: number; closeMs?: number }
async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(unavailable()), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/** The underlying driver MUST disable transparent reconnect. One native session
 * is borrowed by the entire request/job, including gaps between RPCs and provider
 * calls. Consumer release() ends only that borrowed view, not the shared guard.
 */
export async function withRequestMaintenanceGate<T>(
  database: MaintenanceDatabase,
  operation: (borrowed: Database) => Promise<T>,
  deadlines: Deadlines = {},
): Promise<T> {
  const limits = { connectMs: 5_000, queryMs: 15_000, closeMs: 3_000, ...deadlines };
  if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 1)) throw unavailable();
  // A late checkout still belongs to us. Close it; never leak/recycle a session
  // whose acquisition outcome was not observed by the request.
  let checkoutExpired = false;
  const close = async (client: MaintenanceClient) => {
    await bounded(Promise.resolve().then(() => client.end()), limits.closeMs);
    client.release();
  };
  const checkout = Promise.resolve().then(() => database.connect());
  void checkout.then(client => { if (checkoutExpired) void close(client).catch(() => {}); }, () => {});
  let native: MaintenanceClient;
  try { native = await bounded(checkout, limits.connectMs); }
  catch { checkoutExpired = true; throw unavailable(); }
  let acquired = false;
  let returned = false;
  let open = false;
  let healthy = true;
  let result: T | undefined;
  let operationError: unknown;
  let operationFailed = false;
  let cleanupFailed = false;
  const pending = new Set<Promise<unknown>>();
  const originalPid = native.session.pid;
  try {
    const lock = await bounded(native.queryObject<{ acquired: boolean }>(
      "select pg_catalog.pg_try_advisory_lock_shared($1::integer,$2::integer) as acquired", [...MAINTENANCE_KEY],
    ), limits.queryMs);
    if (lock.rows.length !== 1 || typeof lock.rows[0].acquired !== "boolean") throw unavailable();
    if (!lock.rows[0].acquired) {
      // A confirmed false holds no lock and is safe to return immediately.
      native.release(); returned = true;
      throw unavailable();
    }
    acquired = true; open = true;
    if (!Number.isSafeInteger(originalPid) || !native.connected || native.session.pid !== originalPid) throw unavailable();
    const borrowed: Database = {
      async connect(): Promise<SqlClient> {
        if (!open || !healthy) throw unavailable();
        let released = false;
        return {
          async queryObject<R>(query: string, parameters?: unknown[]) {
            if (!open || !healthy || released || !native.connected || native.session.pid !== originalPid) throw unavailable();
            let settled = false;
            const execution = Promise.resolve().then(() => native.queryObject<R>(query, parameters));
            void execution.then(() => { settled = true; }, () => { settled = true; });
            const tracked = bounded(execution, limits.queryMs).catch(error => {
              if (!settled) healthy = false;
              throw error;
            });
            pending.add(tracked);
            void tracked.then(() => pending.delete(tracked), () => pending.delete(tracked));
            return await tracked;
          },
          release() { released = true; },
        };
      },
    };
    // Do not race provider work against a response timer and unlock early.
    // The admitted invocation owns its shared session until its callback settles.
    try { result = await operation(borrowed); }
    catch (error) { operationFailed = true; operationError = error; }
  } catch (error) {
    operationFailed = true; operationError = error instanceof ApiError ? error : unavailable();
  } finally {
    open = false;
    // Detached SQL submitted before the callback returned must drain before
    // unlock. New SQL is rejected by open=false, including late callbacks.
    if (pending.size) await Promise.allSettled([...pending]);
    if (acquired) {
      try {
        if (!healthy || !native.connected || native.session.pid !== originalPid) throw unavailable();
        const unlock = await bounded(native.queryObject<{ released: boolean }>(
          "select pg_catalog.pg_advisory_unlock_shared($1::integer,$2::integer) as released", [...MAINTENANCE_KEY],
        ), limits.queryMs);
        if (unlock.rows.length !== 1 || unlock.rows[0].released !== true) throw unavailable();
        native.release(); returned = true;
      } catch {
        healthy = false; cleanupFailed = true;
        // Never recycle a possibly locked/broken session. A confirmed close
        // releases its locks; an uncertain close stays quarantined, not pooled.
        try { await close(native); returned = true; } catch { /* Remains quarantined. */ }
      }
    } else if (!returned) {
      try { await close(native); returned = true; } catch { /* Unknown acquire result stays quarantined. */ }
    }
  }
  if (cleanupFailed) throw unavailable();
  if (operationFailed) throw operationError;
  return result as T;
}

/** Only the deployed entrypoint uses this wrapper. Existing origin/auth/RBAC
 * checks still run inside createHandler; guard failures preserve CORS/error form.
 */
export function createMaintenanceHandler(
  database: MaintenanceDatabase,
  handlerFor: (borrowed: Database) => (request: Request) => Promise<Response>,
  allowedOrigins: string[],
  validateRequest?: (request: Request) => void,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      validateRequest?.(request);
      const origin = request.headers.get("origin");
      if (request.method === "OPTIONS" && origin && allowedOrigins.includes(origin)) {
        return await handlerFor({ connect: () => Promise.reject(unavailable()) })(request);
      }
      const response = await withRequestMaintenanceGate(database, db => handlerFor(db)(request));
      response.headers.set("X-Recovery-Admission", MAINTENANCE_PROTOCOL);
      return response;
    } catch (error) {
      const response = errorResponse(error instanceof ApiError ? error : unavailable());
      const origin = request.headers.get("origin");
      if (origin && allowedOrigins.includes(origin)) {
        response.headers.set("Access-Control-Allow-Origin", origin);
        response.headers.set("Access-Control-Allow-Credentials", "true");
        response.headers.set("Vary", "Origin");
      }
      return response;
    }
  };
}

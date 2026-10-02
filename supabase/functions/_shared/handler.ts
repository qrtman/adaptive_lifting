import type { AppConfig } from "./config.ts";
import { authenticate } from "./auth/session.ts";
import { authRepository, checkDatabase, type Database } from "./db/mod.ts";
import { ApiError, errorResponse, jsonResponse } from "./errors/mod.ts";
import { handleAnalyticsQuery } from "./analyticsRoute.ts";
import catalog from "../api/catalog.json" with { type: "json" };
import {
  createRealtimeTokenHandler,
} from "../realtime-token-spike/handler.ts";
import type { RealtimeSigner } from "../realtime-token-spike/token.ts";

export function createHandler(
  config: AppConfig,
  db: Database,
  realtimeSigner?: RealtimeSigner,
) {
  const realtimeTokenHandler = realtimeSigner
    ? createRealtimeTokenHandler(config, db, realtimeSigner)
    : null;
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const cors: Record<string, string> =
      origin && config.allowedOrigins.includes(origin)
        ? {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Credentials": "true",
          Vary: "Origin",
        }
        : {};
    if (
      request.method === "OPTIONS" && origin &&
      config.allowedOrigins.includes(origin)
    ) {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
        },
      });
    }
    try {
      const rawPath = new URL(request.url).pathname.replace(
        /^\/functions\/v1\/api/,
        "",
      );
      const path = rawPath === "/api" || rawPath.startsWith("/api/")
        ? rawPath
        : `/api${rawPath}`;
      if (path === "/api/realtime/token") {
        if (!realtimeTokenHandler) {
          throw new ApiError(503, "Realtime token service unavailable");
        }
        return await realtimeTokenHandler(request);
      }
      if (path === "/api/analytics/query") {
        if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
        const principal = await authenticate(request, authRepository(db), config);
        return jsonResponse(await handleAnalyticsQuery(request, config, db, principal), 200, cors);
      }
      if (request.method !== "GET") {
        throw new ApiError(405, "Method not allowed");
      }
      if (path === "/api/health") {
        await checkDatabase(db);
        return jsonResponse({ status: "ok" }, 200, cors);
      }
      if (path === "/api/analytics/catalog") {
        await authenticate(request, authRepository(db), config);
        return jsonResponse(catalog, 200, cors);
      }
      throw new ApiError(404, "Not found");
    } catch (error) {
      const response = errorResponse(error);
      for (const [key, value] of Object.entries(cors)) {
        response.headers.set(key, value);
      }
      return response;
    }
  };
}

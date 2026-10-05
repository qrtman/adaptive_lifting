import type { AppConfig } from "./config.ts";
import { authenticate } from "./auth/session.ts";
import { authRepository, checkDatabase, type Database } from "./db/mod.ts";
import { ApiError, errorResponse, jsonResponse } from "./errors/mod.ts";
import { handleAnalyticsQuery } from "./analyticsRoute.ts";
import { handleInsightCardsRoute } from "./insightCardsRoute.ts";
import { handleInsightCardSync } from "./insightCardSyncRoute.ts";
import { handleWorkoutSync } from "./workoutSyncRoute.ts";
import { handleMicrocyclesRoute } from "./microcyclesRoute.ts";
import { handleCreateSession } from "./createSessionRoute.ts";
import { handleUpdateSession } from "./updateSessionRoute.ts";
import { handleDeleteSession } from "./deleteSessionRoute.ts";
import { handleBulkSessionLabels } from "./bulkSessionLabelsRoute.ts";
import { handleCopyWeek } from "./copyWeekRoute.ts";
import { handleAddSessionExercise } from "./addExerciseRoute.ts";
import { handleUpdateSessionExercise } from "./updateExerciseRoute.ts";
import { handleDeleteSessionExercise } from "./deleteExerciseRoute.ts";
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
          "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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
      if (path.startsWith("/api/_staging/")) {
        throw new ApiError(404, "Not found");
      }
      if (path === "/api/analytics/query") {
        if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
        const principal = await authenticate(request, authRepository(db), config);
        return jsonResponse(await handleAnalyticsQuery(request, config, db, principal), 200, cors);
      }
      if (path === "/api/microcycles") {
        if (request.method !== "GET") throw new ApiError(405, "Method not allowed");
        const principal = await authenticate(request, authRepository(db), config);
        const athleteId = new URL(request.url).searchParams.get("athlete_id") || null;
        const response = await handleMicrocyclesRoute(request, db, principal, config, athleteId);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      if (path === "/api/sessions") {
        if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
        const principal = await authenticate(request, authRepository(db), config);
        const response = await handleCreateSession(request, db, principal, config);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      if (path === "/api/sessions/copy-week") {
        if (request.method !== "POST") throw new ApiError(405, "Method not allowed");
        const principal = await authenticate(request, authRepository(db), config);
        const response = await handleCopyWeek(request, db, principal, config);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      const updateExercise = /^\/api\/sessions\/([^/]+)\/exercises\/([^/]+)$/.exec(path);
      if (updateExercise && request.method === "PATCH") {
        const principal = await authenticate(request, authRepository(db), config);
        let sessionId: string;
        let exerciseId: string;
        try {
          sessionId = decodeURIComponent(updateExercise[1]);
          exerciseId = decodeURIComponent(updateExercise[2]);
        } catch {
          throw new ApiError(400, "Invalid session or lift ID");
        }
        const response = await handleUpdateSessionExercise(
          request,
          sessionId,
          exerciseId,
          db,
          principal,
          config,
        );
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      const deleteExercise = /^\/api\/sessions\/([^/]+)\/exercises\/([^/]+)$/.exec(path);
      if (deleteExercise && request.method === "DELETE") {
        const principal = await authenticate(request, authRepository(db), config);
        let sessionId: string;
        let exerciseId: string;
        try {
          sessionId = decodeURIComponent(deleteExercise[1]);
          exerciseId = decodeURIComponent(deleteExercise[2]);
        } catch {
          throw new ApiError(400, "Invalid session or lift ID");
        }
        const response = await handleDeleteSessionExercise(
          request,
          sessionId,
          exerciseId,
          db,
          principal,
          config,
        );
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      const addExercise = /^\/api\/sessions\/([^/]+)\/exercises$/.exec(path);
      if (addExercise) {
        const principal = await authenticate(request, authRepository(db), config);
        let sessionId: string;
        try {
          sessionId = decodeURIComponent(addExercise[1]);
        } catch {
          throw new ApiError(400, "Invalid session ID");
        }
        const response = await handleAddSessionExercise(request, sessionId, db, principal, config);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      if (path === "/api/sessions/labels") {
        if (request.method !== "PATCH") throw new ApiError(405, "Method not allowed");
        const principal = await authenticate(request, authRepository(db), config);
        const response = await handleBulkSessionLabels(request, db, principal, config);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      const sessionResource = /^\/api\/sessions\/([^/]+)$/.exec(path);
      if (sessionResource) {
        if (request.method !== "PATCH" && request.method !== "DELETE") {
          throw new ApiError(405, "Method not allowed");
        }
        const principal = await authenticate(request, authRepository(db), config);
        let sessionId: string;
        try {
          sessionId = decodeURIComponent(sessionResource[1]);
        } catch {
          throw new ApiError(400, "Invalid session ID");
        }
        const response = request.method === "PATCH"
          ? await handleUpdateSession(request, sessionId, db, principal, config)
          : await handleDeleteSession(sessionId, db, principal, config);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      if (path === "/api/insight-cards/sync") {
        const principal = await authenticate(request, authRepository(db), config);
        return await handleInsightCardSync(request, db, principal);
      }
      const workoutSync = /^\/api\/workouts\/([^/]+)\/sync$/.exec(path);
      if (workoutSync) {
        const principal = await authenticate(request, authRepository(db), config);
        const response = await handleWorkoutSync(request, workoutSync[1], config, db, principal);
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
      }
      if (path === "/api/insight-cards" || /^\/api\/insight-cards\/[^/]+$/.test(path)) {
        const principal = await authenticate(request, authRepository(db), config);
        const response = await handleInsightCardsRoute(
          request,
          config,
          db,
          principal,
          path,
          (catalog.presets ?? []) as Array<{ id?: string | null; name: string; config: Record<string, unknown>; layout: { order: number; col_span: 1 | 2 } }>,
        );
        for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
        return response;
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

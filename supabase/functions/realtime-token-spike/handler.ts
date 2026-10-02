import type { AppConfig } from "../_shared/config.ts";
import { authenticate } from "../_shared/auth/session.ts";
import { authRepository, type Database } from "../_shared/db/mod.ts";
import {
  ApiError,
  errorResponse,
  jsonResponse,
} from "../_shared/errors/mod.ts";
import { issueRealtimeToken, type RealtimeSigner } from "./token.ts";

async function ownsWorkout(
  db: Database,
  workoutId: string,
  userId: string,
): Promise<boolean> {
  const client = await db.connect();
  try {
    const result = await client.queryObject<{ id: string }>(
      "select id from public.workouts where id = $1 and owner_id = $2 and deleted_at is null",
      [workoutId, userId],
    );
    return result.rows.length === 1;
  } finally {
    client.release();
  }
}

export function createRealtimeTokenHandler(
  config: AppConfig,
  db: Database,
  signer: RealtimeSigner,
) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const allowedOrigin = origin && config.allowedOrigins.includes(origin);
    const cors: Record<string, string> = allowedOrigin
      ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        Vary: "Origin",
      }
      : {};
    try {
      if (request.method === "OPTIONS" && allowedOrigin) {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
          },
        });
      }
      if (request.method !== "POST") {
        throw new ApiError(405, "Method not allowed");
      }
      if (origin && !allowedOrigin) {
        throw new ApiError(403, "Origin not allowed");
      }
      if (
        !request.headers.get("content-type")?.startsWith("application/json")
      ) {
        throw new ApiError(415, "JSON required");
      }
      const body = await request.json();
      const workoutId = body?.workout_id;
      if (
        typeof workoutId !== "string" || !/^[0-9a-f-]{36}$/i.test(workoutId)
      ) {
        throw new ApiError(422, "Valid workout_id required");
      }
      const principal = await authenticate(request, authRepository(db), config);
      if (!await ownsWorkout(db, workoutId, principal.user.id)) {
        throw new ApiError(403, "Workout access denied");
      }
      const response = jsonResponse(
        await issueRealtimeToken(principal.user.id, workoutId, signer),
      );
      for (const [name, value] of Object.entries(cors)) {
        response.headers.set(name, value);
      }
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch (error) {
      const response = errorResponse(error);
      for (const [name, value] of Object.entries(cors)) {
        response.headers.set(name, value);
      }
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
  };
}

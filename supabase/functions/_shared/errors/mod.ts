export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string | { code: string; message: string },
    readonly headers: HeadersInit = {},
  ) {
    super(typeof detail === "string" ? detail : detail.message);
  }
}

export const invalidCredentials = () =>
  new ApiError(401, "Could not validate credentials", {
    "WWW-Authenticate": "Bearer",
  });

export function jsonResponse(
  value: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse({ detail: error.detail }, error.status, error.headers);
  }
  console.error("Edge function request failed", error);
  return jsonResponse({ detail: "Internal server error" }, 500);
}

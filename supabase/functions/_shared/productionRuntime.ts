import type { AppConfig } from "./config.ts";

const PRODUCTION_ORIGIN = "https://app.goatedmethod.me";
const PROJECT_REF = "gadusaizqnshxqcckibq";
const RUNTIME_ROLE = "al_edge_catalog_runtime";

/** Release target guard. Staging and local development keep their own settings. */
export function validateProductionRuntime(config: AppConfig): void {
  if (!["production", "prod"].includes(config.appEnv ?? "")) return;
  if (
    config.appUrl !== PRODUCTION_ORIGIN || config.allowedOrigins.length !== 1 ||
    config.allowedOrigins[0] !== PRODUCTION_ORIGIN
  ) {
    throw new Error(
      "Production APP_URL and CORS must use the exact approved application origin",
    );
  }
  let database: URL;
  try {
    database = new URL(config.databaseUrl);
  } catch {
    throw new Error("Production database target is invalid");
  }
  let role: string;
  try {
    role = decodeURIComponent(database.username);
  } catch {
    throw new Error("Production database target is invalid");
  }
  const direct = database.hostname === `db.${PROJECT_REF}.supabase.co` &&
    role === RUNTIME_ROLE;
  const sessionPooler =
    /^aws-\d+-ap-northeast-2\.pooler\.supabase\.com$/.test(database.hostname) &&
    role === `${RUNTIME_ROLE}.${PROJECT_REF}`;
  // Session pooling is required by the email worker's session advisory locks.
  // databaseFromUrl independently enforces TLS for every remote connection.
  if (
    (!direct && !sessionPooler) ||
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    !database.password || database.pathname !== "/postgres" ||
    (database.port && database.port !== "5432") || database.hash ||
    ["disable", "allow", "prefer"].includes(
      database.searchParams.get("sslmode") ?? "",
    )
  ) {
    throw new Error(
      "Production database must use the approved project and restricted runtime role over TLS/session pooling",
    );
  }
}

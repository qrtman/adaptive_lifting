export interface AppConfig {
  databaseUrl: string;
  jwtCurrent: string;
  jwtPrevious: string | null;
  enforceLegacyEmailVerification: boolean;
  analyticsPastDueGraceDays: number;
  allowedOrigins: string[];
  cookieSecure?: boolean;
  sessionLifetimeSeconds?: number;
  offlineAuthPrivateKey?: string | null;
}

type EnvReader = (name: string) => string | undefined;

export function loadConfig(
  read: EnvReader = (name) => Deno.env.get(name),
): AppConfig {
  const databaseUrl = read("DATABASE_URL")?.trim() ?? "";
  const jwtCurrent = read("JWT_SECRET_CURRENT")?.trim() ?? "";
  const rawPrevious = read("JWT_SECRET_PREVIOUS")?.trim() ?? "";
  const origins = (read("CORS_ALLOWED_ORIGINS") ?? "").split(",").map((item) =>
    item.trim()
  ).filter(Boolean);
  const legacy = (read("EMAIL_VERIFICATION_ENFORCE_LEGACY") ?? "false").trim()
    .toLowerCase();
  const rawPastDueGrace = (read("SUBSCRIPTION_PAST_DUE_GRACE_DAYS") ?? "3").trim();
  const analyticsPastDueGraceDays = Number(rawPastDueGrace);
  const rawCookieSecure = (read("COOKIE_SECURE") ?? "").trim().toLowerCase();
  const rawOfflinePrivateKey = read("OFFLINE_AUTH_PRIVATE_KEY")?.trim().replace(/\\n/g, "\n") ?? "";
  const productionLike = ["production", "staging", "prod"].includes(
    (read("APP_ENV") || read("ENV") || "").trim().toLowerCase(),
  ) || ["1", "true", "yes"].includes(rawCookieSecure);
  const cookieSecure = ["1", "true", "yes"].includes(rawCookieSecure) ||
    (!rawCookieSecure && productionLike);
  if (!/^\d+$/.test(rawPastDueGrace) || analyticsPastDueGraceDays > 30) {
    throw new Error("SUBSCRIPTION_PAST_DUE_GRACE_DAYS must be an integer from 0 to 30");
  }
  if (!databaseUrl || !/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  if (!jwtCurrent) throw new Error("JWT_SECRET_CURRENT is required");
  if (!origins.length || origins.includes("*")) {
    throw new Error("CORS_ALLOWED_ORIGINS must list explicit origins");
  }
  if (!["1", "true", "yes", "0", "false", "no"].includes(legacy)) {
    throw new Error("EMAIL_VERIFICATION_ENFORCE_LEGACY must be a boolean");
  }
  if (rawCookieSecure && !["1", "true", "yes", "0", "false", "no"].includes(rawCookieSecure)) {
    throw new Error("COOKIE_SECURE must be a boolean");
  }
  if (productionLike && !cookieSecure) throw new Error("COOKIE_SECURE must be true in production");
  if (productionLike) {
    for (
      const [name, value] of [["JWT_SECRET_CURRENT", jwtCurrent], [
        "JWT_SECRET_PREVIOUS",
        rawPrevious,
      ]]
    ) {
      if (
        value &&
        (value.length < 32 ||
          /^(replace|dev-only|mock_|example|sample|changeme)/i.test(value))
      ) {
        throw new Error(
          `${name} must be a unique non-placeholder secret of at least 32 characters`,
        );
      }
    }
    if (origins.some((origin) => !origin.startsWith("https://"))) {
      throw new Error(
        "CORS_ALLOWED_ORIGINS must use HTTPS in production-like environments",
      );
    }
  }
  return {
    databaseUrl,
    jwtCurrent,
    jwtPrevious: rawPrevious && rawPrevious !== jwtCurrent ? rawPrevious : null,
    enforceLegacyEmailVerification: ["1", "true", "yes"].includes(legacy),
    analyticsPastDueGraceDays,
    allowedOrigins: origins,
    cookieSecure,
    sessionLifetimeSeconds: 7 * 24 * 60 * 60,
    offlineAuthPrivateKey: rawOfflinePrivateKey || null,
  };
}

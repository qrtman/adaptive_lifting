import { loadConfig } from "../_shared/config.ts";
import { databaseFromUrl } from "../_shared/db/mod.ts";
import { createRealtimeTokenHandler } from "./handler.ts";
import { signerFromEnv } from "./token.ts";

const config = loadConfig();
const issuerDatabaseUrl = Deno.env.get("REALTIME_ISSUER_DATABASE_URL");
if (!issuerDatabaseUrl) {
  throw new Error("REALTIME_ISSUER_DATABASE_URL is required");
}
Deno.serve(createRealtimeTokenHandler(
  config,
  databaseFromUrl(issuerDatabaseUrl),
  signerFromEnv(),
));

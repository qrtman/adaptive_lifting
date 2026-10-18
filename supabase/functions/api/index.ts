import { loadConfig } from "../_shared/config.ts";
import { databaseFromUrl } from "../_shared/db/mod.ts";
import { createHandler } from "../_shared/handler.ts";
import { loadRealtimeSignerIfEnabled } from "../_shared/realtime/token.ts";
import { validateProductionRuntime } from "../_shared/productionRuntime.ts";

const config = loadConfig();
validateProductionRuntime(config);
const realtimeSigner = await loadRealtimeSignerIfEnabled(config.realtimeTokensEnabled === true);
Deno.serve(
  createHandler(
    config,
    databaseFromUrl(config.databaseUrl),
    realtimeSigner ?? undefined,
  ),
);

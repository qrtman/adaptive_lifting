import { loadConfig } from "../_shared/config.ts";
import { databaseFromUrl } from "../_shared/db/mod.ts";
import { createHandler } from "../_shared/handler.ts";
import { loadRealtimeSigner } from "../_shared/realtime/token.ts";
import { validateProductionRuntime } from "../_shared/productionRuntime.ts";

const config = loadConfig();
validateProductionRuntime(config);
const realtimeSigner = await loadRealtimeSigner();
Deno.serve(
  createHandler(
    config,
    databaseFromUrl(config.databaseUrl),
    realtimeSigner,
  ),
);

import { loadConfig } from "../_shared/config.ts";
import { databaseFromUrl } from "../_shared/db/mod.ts";
import { createHandler } from "../_shared/handler.ts";
import { loadRealtimeSignerIfEnabled } from "../_shared/realtime/token.ts";
import { validateProductionRuntime } from "../_shared/productionRuntime.ts";
import { createMaintenanceHandler } from "../_shared/recovery/maintenance.ts";
import { enforceMutationOrigin } from "../_shared/requestOrigin.ts";

const config = loadConfig();
validateProductionRuntime(config);
const realtimeSigner = await loadRealtimeSignerIfEnabled(config.realtimeTokensEnabled === true);
Deno.serve(
  createMaintenanceHandler(
    databaseFromUrl(config.databaseUrl),
    db => createHandler(config, db, realtimeSigner ?? undefined),
    config.allowedOrigins,
    request => {
      const raw = new URL(request.url).pathname.replace(/^\/functions\/v1\/api/, "");
      const path = raw === "/api" || raw.startsWith("/api/") ? raw : `/api${raw}`;
      if (path !== "/api/billing/stripe/webhook" && path !== "/api/integrations/telegram/webhook") {
        enforceMutationOrigin(request, config);
      }
    },
  ),
);

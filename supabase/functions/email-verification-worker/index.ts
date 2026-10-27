import { loadConfig } from "../_shared/config.ts";
import { databaseFromUrl } from "../_shared/db/mod.ts";
import { errorResponse } from "../_shared/errors/mod.ts";
import { handleEmailVerificationWorker } from "../_shared/onboardingRoute.ts";
import { validateProductionRuntime } from "../_shared/productionRuntime.ts";
import { createMaintenanceHandler } from "../_shared/recovery/maintenance.ts";

const config = loadConfig();
validateProductionRuntime(config);
const db = databaseFromUrl(config.databaseUrl);

Deno.serve(createMaintenanceHandler(db, borrowed => async (request: Request) => {
  try {
    return await handleEmailVerificationWorker(request, borrowed, config);
  } catch (error) {
    return errorResponse(error);
  }
}, []));

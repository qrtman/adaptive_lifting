import { loadConfig } from "../_shared/config.ts";
import { databaseFromUrl } from "../_shared/db/mod.ts";
import { errorResponse } from "../_shared/errors/mod.ts";
import { handleEmailVerificationWorker } from "../_shared/onboardingRoute.ts";

const config = loadConfig();
const db = databaseFromUrl(config.databaseUrl);

Deno.serve(async (request: Request) => {
  try {
    return await handleEmailVerificationWorker(request, db, config);
  } catch (error) {
    return errorResponse(error);
  }
});

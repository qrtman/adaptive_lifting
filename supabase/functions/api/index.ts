import { loadConfig } from "../_shared/config.ts";
import { databaseFromUrl } from "../_shared/db/mod.ts";
import { createHandler } from "../_shared/handler.ts";

const config = loadConfig();
Deno.serve(createHandler(config, databaseFromUrl(config.databaseUrl)));

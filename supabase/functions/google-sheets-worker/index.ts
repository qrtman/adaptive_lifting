import { loadConfig } from "../_shared/config.ts";
import { databaseFromUrl } from "../_shared/db/mod.ts";
import { errorResponse } from "../_shared/errors/mod.ts";
import { handleGoogleSheetsWorker } from "../_shared/sheetsWorker.ts";
import { createMaintenanceHandler } from "../_shared/recovery/maintenance.ts";

const config=loadConfig();
const db=databaseFromUrl(config.databaseUrl);
Deno.serve(createMaintenanceHandler(db, borrowed => async(request:Request)=>{
  try{return await handleGoogleSheetsWorker(request,borrowed,config);}
  catch(error){return errorResponse(error);}
}, []));

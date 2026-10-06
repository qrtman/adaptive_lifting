import { loadConfig } from "../_shared/config.ts";
import { databaseFromUrl } from "../_shared/db/mod.ts";
import { errorResponse } from "../_shared/errors/mod.ts";
import { handleGoogleSheetsWorker } from "../_shared/sheetsWorker.ts";

const config=loadConfig();
const db=databaseFromUrl(config.databaseUrl);
Deno.serve(async(request:Request)=>{
  try{return await handleGoogleSheetsWorker(request,db,config);}
  catch(error){return errorResponse(error);}
});

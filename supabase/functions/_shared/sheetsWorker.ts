import type { AppConfig } from "./config.ts";
import type { Database, SqlClient } from "./db/mod.ts";
import { ApiError, jsonResponse } from "./errors/mod.ts";
import { fernetDecrypt, fernetEncrypt } from "./fernet.ts";
import { integrationFernetKey } from "./integrationCrypto.ts";
import { finite, makeBatches, rowsFor, sheetText } from "./sheetsExport.ts";

type Json = Record<string, any>;
type WorkerConfig = AppConfig & { fetcher?: typeof fetch };

async function rpc<T>(client: SqlClient, sql: string, args: unknown[] = []): Promise<T> {
  const result = await client.queryObject<{ payload: T }>(sql,args);
  if(!result.rows[0]) throw new Error("Sheets worker database interface returned no result");
  const value=result.rows[0].payload;
  return (typeof value==="string"?JSON.parse(value):value) as T;
}

async function secret(client: SqlClient,name:string,envValue?:string|null):Promise<string>{
  if(envValue?.trim()) return envValue.trim();
  try {const result=await client.queryObject<{value:string|null}>("select al_private.al_integration_secret($1::text) as value",[name]);return result.rows[0]?.value?.trim()??"";} catch{return "";}
}

function equal(a:string,b:string):boolean{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);let d=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)d|=(x[i]??0)^(y[i]??0);return d===0;}
async function send(fetcher:typeof fetch,url:string,token:string,body?:unknown,method="POST"):Promise<Response>{
  return await fetcher(url,{method,headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
}

export async function handleGoogleSheetsWorker(request:Request,db:Database,config:WorkerConfig):Promise<Response>{
  if(request.method!=="POST") throw new ApiError(405,"Method not allowed");
  const client=await db.connect();
  const connectionLocks=new Set<string>();
  try{
    const internal=await secret(client,"adaptive_lifting_google_sheets_worker_internal_secret");
    const bearer=request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1]??"";
    if(!internal||!equal(internal,bearer)) throw new ApiError(401,"Not authorized");
    const clientId=await secret(client,"adaptive_lifting_google_oauth_client_id",config.googleSheetsClientId);
    const clientSecret=await secret(client,"adaptive_lifting_google_oauth_client_secret",config.googleSheetsClientSecret);
    const key=await secret(client,"adaptive_lifting_integration_encryption_key",config.integrationEncryptionKey);
    if(!clientId||!clientSecret||!key) throw new ApiError(503,"Google Sheets worker is not configured");
    const fernetKey=await integrationFernetKey(key);
    const fetcher=config.fetcher??fetch;const totals={claimed:0,success:0,failed:0};
    for(let i=0;i<10;i++){
      const claimToken=crypto.randomUUID();const claim=await rpc<Json>(client,"select al_private.al_sheets_worker_claim($1::text) as payload",[claimToken]);
      const jobId=typeof claim.jobId==="string"?claim.jobId:"";if(!jobId)break;totals.claimed++;
      if(typeof claim.connectionId==="string") connectionLocks.add(claim.connectionId);
      const begin=await rpc<Json>(client,"select al_private.al_sheets_worker_begin($1::text,$2::text,$3::boolean,$4::integer) as payload",[jobId,claimToken,config.enforceLegacyEmailVerification,config.analyticsPastDueGraceDays]);
      if(begin.busy===true){totals.claimed--;continue;}
      let success=false,result="Export failed";
      let payload:Json={};
      try{payload=typeof claim.payload==="string"?JSON.parse(claim.payload):claim.payload&&typeof claim.payload==="object"?claim.payload:{};}catch{payload={};}
      let accessCipher:string|null=null,accessExp:string|null=null;
      try{
        if(begin.send!==true) throw new Error("Export authorization is no longer valid");
        const creds=await rpc<Json>(client,"select al_private.al_sheets_worker_credentials($1::text,$2::text) as payload",[jobId,claimToken]);
        if(!creds.accessCipher) throw new Error("Google Sheets credentials are unavailable");
        let access=await fernetDecrypt(String(creds.accessCipher),fernetKey);const expiry=creds.accessExpiresAt?new Date(String(creds.accessExpiresAt)).getTime():0;
        if(expiry<Date.now()+120000){
          if(!creds.refreshCipher) throw new Error("Google Sheets refresh credential is unavailable");
          const refresh=await fernetDecrypt(String(creds.refreshCipher),fernetKey);
          const response=await fetcher("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refresh,grant_type:"refresh_token"}),signal:AbortSignal.timeout(8000)});
          if(!response.ok)throw new Error("Google token refresh failed");const data=await response.json() as Json;if(typeof data.access_token!=="string")throw new Error("Google token refresh failed");
          access=data.access_token;accessCipher=await fernetEncrypt(access,fernetKey);accessExp=new Date(Date.now()+Math.max(60,finite(data.expires_in)||3600)*1000).toISOString();
          if(typeof data.refresh_token==="string"&&data.refresh_token)payload._refresh_token_cipher=await fernetEncrypt(data.refresh_token,fernetKey);
        }
        const tree=Array.isArray(begin.microcycles)?begin.microcycles:[];const {workouts,sets}=rowsFor(tree);
        if(!workouts.length)throw new Error("No training workouts found for chosen athlete/mesocycle");
        const tabs=payload.tabs===undefined?["Sets","Workouts","INOL","ACWR","e1RM"]:payload.tabs;
        const batches=makeBatches(tabs,workouts,sets);const sheetName=String(payload.sheet_name??"Mesocycle Export").slice(0,100);
        const headers={authorization:`Bearer ${access}`,"content-type":"application/json"};
        let spreadsheetId=typeof payload._spreadsheet_id==="string"?payload._spreadsheet_id:"";
        if(!spreadsheetId){
          if(payload._spreadsheet_create_started===true)throw new Error("Spreadsheet creation outcome is uncertain; automatic retry stopped");
          payload._spreadsheet_create_started=true;
          await rpc(client,"select al_private.al_sheets_worker_checkpoint($1::text,$2::text,$3::text) as payload",[jobId,claimToken,JSON.stringify(payload)]);
          const created=await fetcher("https://sheets.googleapis.com/v4/spreadsheets",{method:"POST",headers,body:JSON.stringify({properties:{title:sheetName}}),signal:AbortSignal.timeout(8000)});
          if(!created.ok)throw new Error("Google Spreadsheet creation failed; automatic retry stopped");
          const data=await created.json() as Json;if(typeof data.spreadsheetId!=="string")throw new Error("Spreadsheet creation outcome is uncertain; automatic retry stopped");
          spreadsheetId=data.spreadsheetId;payload._spreadsheet_id=spreadsheetId;
          await rpc(client,"select al_private.al_sheets_worker_checkpoint($1::text,$2::text,$3::text) as payload",[jobId,claimToken,JSON.stringify(payload)]);
        }
        const current=await send(fetcher,`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`,access,undefined,"GET");
        if(!current.ok)throw new Error("Could not inspect spreadsheet tabs");const currentData=await current.json() as Json;const existing=Array.isArray(currentData.sheets)?currentData.sheets:[];const allowed=Array.isArray(tabs)?[...new Set(tabs as string[])]:[];
        const requests=allowed.filter(tab=>!existing.some((s:Json)=>s.properties?.title===tab)).map(title=>({addSheet:{properties:{title}}}));
        const defaultSheet=existing.find((s:Json)=>s.properties?.sheetId===0)?.properties;if(defaultSheet&&!allowed.includes(defaultSheet.title))requests.push({deleteSheet:{sheetId:0}} as never);
        if(requests.length){const resp=await send(fetcher,`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,access,{requests});if(!resp.ok)throw new Error("Sheet structure creation failed");}
        if(batches.length){const resp=await send(fetcher,`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,access,{valueInputOption:"USER_ENTERED",data:batches});if(!resp.ok)throw new Error("Writing spreadsheet values failed");}
        result=`https://docs.google.com/spreadsheets/d/${spreadsheetId}`;success=true;
      }catch(error){
        result=error instanceof Error?error.message:"Export failed";
        if(result.includes("outcome is uncertain")||result.includes("automatic retry stopped")) payload._spreadsheet_create_started=true;
      }
      if(!success&&claim.attempt>=3)totals.failed++;if(success)totals.success++;
      const refreshCipher=typeof payload._refresh_token_cipher==="string"?payload._refresh_token_cipher:null;delete payload._refresh_token_cipher;
      await rpc(client,"select al_private.al_sheets_worker_finish($1::text,$2::text,$3::boolean,$4::text,$5::text,$6::text,$7::timestamptz,$8::text) as payload",
        [jobId,claimToken,success,result,JSON.stringify(payload),accessCipher,accessExp,refreshCipher]);
    }
    return jsonResponse({status:"ok",...totals},200,{"cache-control":"no-store"});
  }finally{
    for(const connectionId of connectionLocks){
      await client.queryObject("select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('sheets-connection:'||$1::text,0)) as unlocked",[connectionId]).catch(()=>null);
    }
    client.release();
  }
}

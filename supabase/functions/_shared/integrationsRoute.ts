import { fernetEncrypt } from "./fernet.ts";
import { integrationFernetKey } from "./integrationCrypto.ts";
import type { AppConfig } from "./config.ts";
import type { Database } from "./db/mod.ts";
import { ApiError, jsonResponse } from "./errors/mod.ts";
import { authenticate } from "./auth/session.ts";
import { authRepository } from "./db/mod.ts";
import type { Principal } from "./types/mod.ts";
import { sessionResponse } from "./sessionResponse.ts";
import { verifyTelegramInitData } from "./telegramAuth.ts";

type Json = Record<string, unknown>;
const DEFAULT_TABS = ["Sets", "Workouts", "INOL", "ACWR", "e1RM"];

async function rpc<T>(db: Database, sql: string, args: unknown[] = []): Promise<T> {
  const client = await db.connect();
  try {
    const result = await client.queryObject<{ payload: T }>(sql, args);
    if (!result.rows[0]) throw new Error("Integration database interface returned no result");
    const value = result.rows[0].payload;
    return (typeof value === "string" ? JSON.parse(value) : value) as T;
  } finally { client.release(); }
}

async function secret(db: Database, name: string, envValue?: string | null): Promise<string> {
  if (envValue?.trim()) return envValue.trim();
  try {
    const client = await db.connect();
    try {
      const result = await client.queryObject<{ value: string | null }>(
        "select al_private.al_integration_secret($1::text) as value", [name]);
      return result.rows[0]?.value?.trim() ?? "";
    } finally { client.release(); }
  } catch { return ""; }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function mapDenial(denial: unknown): never | void {
  if (!denial) return;
  const key = String(denial);
  const errors: Record<string, [number, string | Json]> = {
    invalid_session: [401, "Could not validate credentials"],
    account_ineligible: [403, { code: "EMAIL_VERIFICATION_REQUIRED", message: "Verify your email before signing in." }],
    invalid_request: [422, "Invalid request"],
    invalid_link_token: [400, "Link token expired or invalid"],
    user_missing: [404, "Associated user not found"],
    telegram_not_linked: [403, "Telegram account not linked. Connect from settings first."],
    telegram_identity_in_use: [409, "Telegram account is already linked to another user"],
    coach_only: [403, "Google Sheets is available to coaches"],
    integrations_required: [403, { code: "FEATURE_NOT_INCLUDED", feature: "integrations", message: "This coaching plan does not include integrations." }],
    invalid_state: [400, "Invalid or already used OAuth state"],
    account_unavailable: [403, "This account is unavailable"],
    missing_publish_fields: [400, "Missing athlete_id or mesocycle_id"],
    relationship_required: [403, "Unauthorized: No active relationship with this athlete"],
    mesocycle_not_owned: [403, "Unauthorized: Mesocycle does not belong to this athlete"],
    not_connected: [400, "Google Sheets integration not connected"],
  };
  const [status, detail] = errors[key] ?? [500, "Internal server error"];
  throw new ApiError(status, detail);
}

function constantTimeEqual(a: string, b: string): boolean {
  const left=new TextEncoder().encode(a), right=new TextEncoder().encode(b);
  let diff=left.length^right.length; for(let i=0;i<Math.max(left.length,right.length);i++) diff|=(left[i]??0)^(right[i]??0);
  return diff===0;
}

async function postTelegram(botToken: string, chatId: unknown, text: string, replyMarkup?: unknown): Promise<boolean> {
  if (!botToken || botToken === "mock_bot_token") return false;
  try {
    const response=await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({chat_id:chatId,text,parse_mode:"HTML",...(replyMarkup?{reply_markup:replyMarkup}:{})}),
      signal:AbortSignal.timeout(6000),
    });
    return response.ok;
  } catch { return false; }
}

async function handleTelegramWebhook(request: Request, db: Database, config: AppConfig): Promise<Response> {
  const bot = await secret(db,"adaptive_lifting_telegram_bot_token",config.telegramBotToken);
  const expected = await secret(db,"adaptive_lifting_telegram_webhook_secret",config.telegramWebhookSecret);
  if(!bot || !expected || bot==="mock_bot_token" || expected==="mock_webhook_secret") throw new ApiError(503,"Telegram webhook secret is not configured");
  const actual=request.headers.get("x-telegram-bot-api-secret-token")??"";
  if(!constantTimeEqual(actual,expected)) throw new ApiError(403,"Invalid webhook secret token");
  let body: Json; try { body=await request.json() as Json; } catch { throw new ApiError(422,"Invalid request body"); }
  const updateId=body.update_id;
  if(typeof updateId!=="number" && typeof updateId!=="string") return jsonResponse({status:"ignored"});
  const claim=crypto.randomUUID();
  const claimed=await rpc<Json>(db,"select al_private.al_telegram_webhook_claim($1::text,$2::text) as payload",[String(updateId),claim]);
  if(claimed.duplicate===true) return jsonResponse({status:"duplicate_ok"});
  const message=body.message as Json|undefined;
  if(!message || typeof message.text!=="string") {
    await rpc(db,"select al_private.al_telegram_webhook_finish($1::text,$2::text,true) as payload",[String(updateId),claim]);
    return jsonResponse({status:"processed"});
  }
  const text=message.text.trim(); const from=message.from as Json|undefined; const chat=message.chat as Json|undefined;
  const chatId=chat?.id;
  let responseText=""; let markup: unknown;
  try {
    const startToken=/^\/start(?:\s+)(\S+)$/u.exec(text)?.[1]??null;
    const result=await rpc<Json>(db,"select al_private.al_telegram_webhook_command($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::boolean) as payload",
      [String(updateId),claim,String(from?.id??""),text,String(chatId??""),startToken?await sha256Hex(startToken):null,config.enforceLegacyEmailVerification]);
    responseText=String(result.message??"");
    markup=result.replyMarkup===undefined?undefined:JSON.parse(JSON.stringify(result.replyMarkup).replaceAll("__APP_URL__",(config.appUrl??"").replace(/\/$/,"")));
    if(result.retry===true) {
      await rpc(db,"select al_private.al_telegram_webhook_finish($1::text,$2::text,false) as payload",[String(updateId),claim]);
      return jsonResponse({status:"retry"},503);
    }
    if(responseText) await postTelegram(bot,chatId,responseText,markup);
    await rpc(db,"select al_private.al_telegram_webhook_finish($1::text,$2::text,true) as payload",[String(updateId),claim]);
    return jsonResponse({status:"processed"});
  } catch {
    await rpc(db,"select al_private.al_telegram_webhook_finish($1::text,$2::text,false) as payload",[String(updateId),claim]).catch(()=>null);
    throw new ApiError(503,"Telegram webhook processing failed");
  }
}

function denialResponse(denial: unknown): void { mapDenial(denial); }

export async function handleIntegrationsRoute(
  request: Request, db: Database, config: AppConfig,
): Promise<Response|null> {
  const pathname=new URL(request.url).pathname.replace(/^\/functions\/v1\/api/,"");
  const path=pathname.startsWith("/api/")?pathname:`/api${pathname}`;
  const telegram=path.startsWith("/api/integrations/telegram");
  const sheets=path.startsWith("/api/integrations/google-sheets");
  if(!telegram&&!sheets) return null;
  if(path==="/api/integrations/telegram/webhook") {
    if(request.method!=="POST") throw new ApiError(405,"Method not allowed");
    return await handleTelegramWebhook(request,db,config);
  }
  if(path==="/api/integrations/telegram/miniapp/session") {
    if(request.method!=="POST") throw new ApiError(405,"Method not allowed");
    let body:Json; try{body=await request.json() as Json;}catch{throw new ApiError(422,"Invalid request body");}
    if(typeof body.initData!=="string"||!body.initData) throw new ApiError(400,"Missing initData");
    const bot=await secret(db,"adaptive_lifting_telegram_bot_token",config.telegramBotToken);
    if(!bot||bot==="mock_bot_token") throw new ApiError(503,"Telegram login is not configured");
    let user: Record<string, unknown>;
    try { user=await verifyTelegramInitData(body.initData,bot); }
    catch { throw new ApiError(401,"Invalid Telegram authentication"); }
    const link=typeof body.linkToken==="string"&&body.linkToken?await sha256Hex(body.linkToken):null;
    const sessionId=crypto.randomUUID();
    const result=await rpc<Json>(db,"select al_private.al_telegram_session($1::text,$2::text,$3::text,$4::boolean) as payload",[String(user.id),link,sessionId,config.enforceLegacyEmailVerification]);
    denialResponse(result.denial);
    const response=await sessionResponse({id:String(result.id),email:String(result.email),role:String(result.role),displayName:typeof result.displayName==="string"?result.displayName:null},sessionId,config);
    const data=await response.json();
    return jsonResponse({status:"success",access_token:data.access_token,user:{id:result.id,email:result.email,role:result.role,tg_username:user.username??null}},response.status,Object.fromEntries(response.headers));
  }
  const principal: Principal=await authenticate(request,authRepository(db),config);
  const actor=principal.user.id, sid=principal.sessionId, enforce=config.enforceLegacyEmailVerification;
  if(path==="/api/integrations/telegram/link-token"&&request.method==="POST") {
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>String.fromCharCode(b)).join("");
    const opaque=btoa(token).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
    mapDenial((await rpc<Json>(db,"select al_private.al_telegram_link_token_create($1::text,$2::text,$3::text,$4::boolean) as payload",[actor,sid,await sha256Hex(opaque),enforce])).denial);
    return jsonResponse({token:opaque,bot_username:"AdaptiveLiftingBot"},200,{"cache-control":"no-store"});
  }
  if(path==="/api/integrations/telegram/status"&&request.method==="GET") {
    const result=await rpc<Json>(db,"select al_private.al_telegram_connection($1::text,$2::text,false,$3::boolean) as payload",[actor,sid,enforce]);
    denialResponse(result.denial); return jsonResponse({status:result.status,...(result.external_account_id?{external_account_id:result.external_account_id}:{})});
  }
  if(path==="/api/integrations/telegram"&&request.method==="DELETE") {
    const result=await rpc<Json>(db,"select al_private.al_telegram_connection($1::text,$2::text,true,$3::boolean) as payload",[actor,sid,enforce]);
    denialResponse(result.denial); return jsonResponse({status:"disconnected"});
  }
  const grace=config.analyticsPastDueGraceDays;
  const access=async()=>await secret(db,"adaptive_lifting_google_oauth_client_id",config.googleSheetsClientId);
  if(path==="/api/integrations/google-sheets/auth-url"&&request.method==="GET") {
    mapDenial((await rpc<Json>(db,"select al_private.al_sheets_actor($1::text,$2::text,$3::boolean,$4::integer) as payload",[actor,sid,enforce,grace])).denial);
    const clientId=await access(); if(!clientId) throw new ApiError(503,"Google Sheets is not configured");
    const state=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>String.fromCharCode(b)).join("");
    const opaque=btoa(state).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
    mapDenial((await rpc<Json>(db,"select al_private.al_sheets_state_create($1::text,$2::text,$3::text,$4::boolean,$5::integer) as payload",[actor,sid,await sha256Hex(opaque),enforce,grace])).denial);
    const redirectUri=`${(config.appUrl??"").replace(/\/$/,"")}/api/integrations/google-sheets/callback`;
    const params=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:"code",scope:"https://www.googleapis.com/auth/spreadsheets",access_type:"offline",prompt:"consent",state:opaque});
    return jsonResponse({auth_url:`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`},200,{"cache-control":"no-store"});
  }
  if(path==="/api/integrations/google-sheets/callback"&&request.method==="GET") {
    const url=new URL(request.url), code=url.searchParams.get("code"), state=url.searchParams.get("state");
    if(!code||!state) throw new ApiError(400,"Missing authorization parameters");
    const clientId=await access(); const clientSecret=await secret(db,"adaptive_lifting_google_oauth_client_secret",config.googleSheetsClientSecret);
    if(!clientId||!clientSecret) throw new ApiError(503,"Google Sheets is not configured");
    const owner=await rpc<Json>(db,"select al_private.al_sheets_state_consume($1::text,$2::boolean,$3::integer) as payload",[await sha256Hex(state),enforce,grace]);
    mapDenial(owner.denial);
    const redirectUri=`${(config.appUrl??"").replace(/\/$/,"")}/api/integrations/google-sheets/callback`;
    let tokenData:Json;
    try {
      const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:"authorization_code"}),signal:AbortSignal.timeout(8000)});
      if(!response.ok) throw new Error("provider"); tokenData=await response.json() as Json;
    } catch { throw new ApiError(400,"Google authorization could not be completed"); }
    if(typeof tokenData.access_token!=="string"||!tokenData.access_token) throw new ApiError(400,"Google authorization could not be completed");
    const key=await secret(db,"adaptive_lifting_integration_encryption_key",config.integrationEncryptionKey);
    if(!key) throw new ApiError(503,"Google Sheets is not configured");
    const fernetKey=await integrationFernetKey(key);
    const accessCipher=await fernetEncrypt(tokenData.access_token,fernetKey);
    const refreshCipher=typeof tokenData.refresh_token==="string"&&tokenData.refresh_token?await fernetEncrypt(tokenData.refresh_token,fernetKey):null;
    const expires=Number(tokenData.expires_in); const expiresAt=new Date(Date.now()+(Number.isFinite(expires)&&expires>0?expires:3600)*1000).toISOString();
    const saved=await rpc<Json>(db,"select al_private.al_sheets_credentials_save($1::text,$2::text,$3::text,$4::timestamptz,$5::text,$6::boolean,$7::integer) as payload",[String(owner.userId),String(owner.sessionId),accessCipher,expiresAt,refreshCipher,enforce,grace]);
    mapDenial(saved.denial);
    return new Response("<!doctype html><html><body style=\"background:#0A0A0A;color:#FFF;font-family:sans-serif;display:grid;place-items:center;height:100vh\"><main><h2>Google Sheets Connected Successfully!</h2><p>You can close this tab and return to settings.</p><script>setTimeout(()=>window.close(),2500)</script></main></body></html>",{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
  }
  if(path==="/api/integrations/google-sheets/status"&&request.method==="GET") {
    const result=await rpc<Json>(db,"select al_private.al_sheets_status($1::text,$2::text,$3::boolean) as payload",[actor,sid,enforce]);
    denialResponse(result.denial); const {denial:_,...body}=result; return jsonResponse(body);
  }
  if(path==="/api/integrations/google-sheets"&&request.method==="DELETE") {
    const result=await rpc<Json>(db,"select al_private.al_sheets_disconnect($1::text,$2::text,$3::boolean) as payload",[actor,sid,enforce]);
    denialResponse(result.denial); return jsonResponse({status:"disconnected"});
  }
  if(path==="/api/integrations/google-sheets/publish"&&request.method==="POST") {
    mapDenial((await rpc<Json>(db,"select al_private.al_sheets_actor($1::text,$2::text,$3::boolean,$4::integer) as payload",[actor,sid,enforce,grace])).denial);
    let body:Json;try{body=await request.json() as Json;}catch{throw new ApiError(422,"Invalid request body");}
    if(typeof body.athlete_id!=="string"||!body.athlete_id||typeof body.mesocycle_id!=="string"||!body.mesocycle_id) throw new ApiError(400,"Missing athlete_id or mesocycle_id");
    const payload={athlete_id:body.athlete_id,mesocycle_id:body.mesocycle_id,requested_session_id:sid,sheet_name:typeof body.sheetName==="string"?body.sheetName:"Mesocycle Export",tabs:body.tabs===undefined?DEFAULT_TABS:body.tabs};
    const result=await rpc<Json>(db,"select al_private.al_sheets_publish($1::text,$2::text,$3::text,$4::text,$5::text,$6::text,$7::boolean,$8::integer) as payload",[actor,sid,payload.athlete_id,payload.mesocycle_id,JSON.stringify(payload),crypto.randomUUID(),enforce,grace]);
    denialResponse(result.denial); return jsonResponse({status:"queued",job_id:result.job_id});
  }
  throw new ApiError(405,"Method not allowed");
}

export { DEFAULT_TABS };

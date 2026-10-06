import type { Database, SqlClient } from "./db/mod.ts";
import { fernetDecrypt } from "./fernet.ts";

export interface EmailWorkerConfig {
  payloadKey: string;
  emailApiKey: string;
  emailFrom: string;
  appUrl: string;
  enforceLegacy: boolean;
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export type EmailWorkerOutcome = "empty" | "accepted" | "deferred" | "cancelled";

async function scalar<T>(client: SqlClient, sql: string, args: unknown[]): Promise<T | null> {
  const result = await client.queryObject<{ payload: T }>(sql, args);
  return result.rows[0]?.payload ?? null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function emailContent(url: string): { text: string; html: string } {
  const safeUrl = escapeHtml(url);
  return {
    text: `Verify your Adaptive Lifting email\n\nConfirm your email: ${url}\n\nThis single-use link expires 24 hours after your request. Confirm on the page, then sign in. If you did not register, you can ignore this email.`,
    html: `<h1>Verify your Adaptive Lifting email</h1><p><a style="display:inline-block;padding:14px 20px;background:#202020;color:#ffffff;border-radius:6px;text-decoration:none" href="${safeUrl}">Verify email address</a></p><p>This single-use link expires 24 hours after your request. Confirm on the page, then sign in.</p><p>If you did not register, you can ignore this email.</p>`,
  };
}

async function unlock(client: SqlClient, userId: string): Promise<void> {
  try {
    await scalar(client, "select al_private.al_email_worker_unlock($1::text) as payload", [userId]);
  } catch {
    // Closing the client also releases the session advisory lock.
  }
}

export async function tryProcessEmailVerificationJob(
  db: Database,
  config: EmailWorkerConfig,
): Promise<EmailWorkerOutcome> {
  const client = await db.connect();
  let lockUserId: string | null = null;
  try {
    const claimToken = crypto.randomUUID();
    const claim = await scalar<Record<string, unknown>>(client,
      "select al_private.al_email_worker_claim($1::text) as payload", [claimToken]);
    const jobId = typeof claim?.jobId === "string" ? claim.jobId : "";
    if (!jobId) return "empty";

    const begin = await scalar<Record<string, unknown>>(client,
      "select al_private.al_email_worker_begin($1::text,$2::text,$3::boolean) as payload",
      [jobId, claimToken, config.enforceLegacy]);
    if (begin?.busy === true) return "deferred";
    if (begin?.send !== true) return "cancelled";
    if (typeof begin.userId !== "string" || typeof begin.email !== "string" ||
        typeof begin.encryptedPayload !== "string") return "cancelled";
    lockUserId = begin.userId;

    let rawToken = "";
    try {
      rawToken = await fernetDecrypt(begin.encryptedPayload, config.payloadKey);
      if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) rawToken = "";
    } catch {
      rawToken = "";
    }
    let outcome: "success" | "temporary" | "permanent" = rawToken ? "success" : "permanent";
    if (rawToken) {
      try {
      const verificationUrl = `${config.appUrl.replace(/\/$/, "")}/verify-email#token=${rawToken}`;
      const content = emailContent(verificationUrl);
      const response = await config.fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.emailApiKey}`,
          "content-type": "application/json",
          "idempotency-key": jobId,
        },
        body: JSON.stringify({
          from: config.emailFrom,
          to: [begin.email],
          subject: "Verify your Adaptive Lifting email",
          text: content.text,
          html: content.html,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.status >= 200 && response.status < 300) outcome = "success";
      else if (response.status === 408 || response.status === 429 || response.status >= 500) outcome = "temporary";
      else outcome = "permanent";
      } catch {
        // Network errors and timeouts are retryable. Never persist provider
        // bodies, URLs, recipients, tokens, or exception text.
        outcome = "temporary";
      }
    }

    const result = await scalar<Record<string, unknown>>(client,
      "select al_private.al_email_worker_finish($1::text,$2::text,$3::text,$4::text) as payload",
      [jobId, claimToken, lockUserId, outcome]);
    lockUserId = null; // finish releases the advisory lock on this session.
    return result?.updated === true && outcome === "success" ? "accepted" : "deferred";
  } finally {
    if (lockUserId) await unlock(client, lockUserId);
    client.release();
  }
}

export { emailContent };

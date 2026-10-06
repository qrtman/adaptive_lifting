import { describe, expect, it } from "vitest";
import { escapeTelegramHtml, verifyTelegramInitData } from "../../supabase/functions/_shared/telegramAuth.ts";

const botToken = "123456789:controlled-staging-test-token";

async function hmac(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signedInitData(fields: Record<string, string> = {}): Promise<string> {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "test-query",
    user: JSON.stringify({ id: 445566, first_name: "Test", username: "tester" }),
    ...fields,
  });
  const derived = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`).join("\n");
  params.set("hash", hex(await hmac(derived, check)));
  return params.toString();
}

describe("Telegram WebApp initData", () => {
  it("accepts valid Telegram signatures and current auth_date", async () => {
    await expect(verifyTelegramInitData(await signedInitData(), botToken)).resolves.toMatchObject({
      id: 445566,
      username: "tester",
    });
  });

  it("rejects tampering, stale/future dates, duplicate keys, and placeholder secrets", async () => {
    const signed = await signedInitData();
    await expect(verifyTelegramInitData(signed.replace("test-query", "changed"), botToken)).rejects.toThrow("Invalid Telegram authentication");
    await expect(verifyTelegramInitData(await signedInitData({ auth_date: String(Math.floor(Date.now() / 1000) - 301) }), botToken)).rejects.toThrow("Invalid Telegram authentication");
    await expect(verifyTelegramInitData(await signedInitData({ auth_date: String(Math.floor(Date.now() / 1000) + 31) }), botToken)).rejects.toThrow("Invalid Telegram authentication");
    await expect(verifyTelegramInitData(`${signed}&auth_date=1`, botToken)).rejects.toThrow("Invalid Telegram authentication");
    await expect(verifyTelegramInitData(signed, "mock_bot_token")).rejects.toThrow("Invalid Telegram authentication");
  });

  it("rejects absent or malformed authentication fields without echoing input", async () => {
    await expect(verifyTelegramInitData("", botToken)).rejects.toThrow("Missing initData");
    await expect(verifyTelegramInitData("auth_date=x&user=%7B%7D&hash=bad", botToken)).rejects.toThrow("Invalid Telegram authentication");
    await expect(verifyTelegramInitData("auth_date=1&user=%7B%22id%22%3A1%7D", botToken)).rejects.toThrow("Invalid Telegram authentication");
    await expect(verifyTelegramInitData(await signedInitData({ user: "not-json" }), botToken)).rejects.toThrow("Invalid Telegram authentication");
    await expect(verifyTelegramInitData(await signedInitData({ user: JSON.stringify({ id: 0 }) }), botToken)).rejects.toThrow("Invalid Telegram authentication");
  });
});

it("escapes user-controlled Telegram HTML text", () => {
  expect(escapeTelegramHtml(`<lift & "quote">'`)).toBe("&lt;lift &amp; &quot;quote&quot;&gt;&#39;");
});

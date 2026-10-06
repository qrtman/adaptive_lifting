/** Verify Telegram WebApp initData without exposing verification material. */
export async function verifyTelegramInitData(
  data: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Record<string, unknown>> {
  if (!data) throw new Error("Missing initData");
  try {
    if (!botToken || botToken === "mock_bot_token") throw new Error("invalid");
    const params = new URLSearchParams(data);
    const entries = [...params.entries()];
    if (!entries.length || new Set(entries.map(([key]) => key)).size !== entries.length) {
      throw new Error("invalid");
    }
    const hash = params.get("hash") ?? "";
    if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error("invalid");
    params.delete("hash");
    const checkString = [...params.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const root = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("WebAppData"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const derived = await crypto.subtle.sign(
      "HMAC",
      root,
      new TextEncoder().encode(botToken),
    );
    const verificationKey = await crypto.subtle.importKey(
      "raw",
      derived,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      verificationKey,
      new TextEncoder().encode(checkString),
    ));
    const received = hash.toLowerCase().match(/../g)!.map((pair) => parseInt(pair, 16));
    let difference = 0;
    for (let index = 0; index < 32; index++) difference |= expected[index] ^ received[index];
    if (difference !== 0) throw new Error("invalid");

    const rawDate = params.get("auth_date") ?? "";
    if (!/^\d+$/.test(rawDate)) throw new Error("invalid");
    const age = nowSeconds - Number(rawDate);
    if (age < -30 || age > 300) throw new Error("invalid");
    const rawUser = params.get("user");
    if (!rawUser) throw new Error("invalid");
    const user = JSON.parse(rawUser);
    if (!user || typeof user !== "object" || !Number.isSafeInteger(user.id) || user.id <= 0) {
      throw new Error("invalid");
    }
    return user as Record<string, unknown>;
  } catch {
    throw new Error("Invalid Telegram authentication");
  }
}

export function escapeTelegramHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

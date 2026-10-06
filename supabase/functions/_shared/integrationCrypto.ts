/** Matches backend.integrations._fernet_for_key: SHA-256 the configured text key,
 * then URL-safe-base64 encode the resulting 32-byte Fernet key. */
export async function integrationFernetKey(secret: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  let binary = "";
  for (let index = 0; index < digest.length; index += 0x8000) {
    binary += String.fromCharCode(...digest.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

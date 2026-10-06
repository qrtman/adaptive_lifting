// Small WebCrypto Fernet-compatible codec. This preserves the Python worker's
// AES-CBC/HMAC payload format without pulling a Python runtime into Edge.
function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

function concatenate(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function fernetKeys(encodedKey: string): { signing: Uint8Array; encryption: Uint8Array } {
  const key = decodeBase64Url(encodedKey);
  if (key.length !== 32) throw new Error("Invalid email payload key");
  return { signing: key.subarray(0, 16), encryption: key.subarray(16, 32) };
}

export async function fernetEncrypt(plaintext: string, encodedKey: string): Promise<string> {
  const { signing, encryption } = fernetKeys(encodedKey);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const timestamp = new Uint8Array(8);
  new DataView(timestamp.buffer).setBigUint64(0, BigInt(Math.floor(Date.now() / 1000)), false);
  const aesKey = await crypto.subtle.importKey("raw", encryption, "AES-CBC", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-CBC", iv }, aesKey, new TextEncoder().encode(plaintext),
  ));
  const unsigned = concatenate(new Uint8Array([0x80]), timestamp, iv, ciphertext);
  const hmacKey = await crypto.subtle.importKey("raw", signing, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, unsigned));
  return encodeBase64Url(concatenate(unsigned, signature));
}

export async function fernetDecrypt(token: string, encodedKey: string): Promise<string> {
  const { signing, encryption } = fernetKeys(encodedKey);
  const bytes = decodeBase64Url(token);
  if (bytes.length < 73 || bytes[0] !== 0x80 || (bytes.length - 57) % 16 !== 0) {
    throw new Error("Invalid encrypted email payload");
  }
  const unsigned = bytes.subarray(0, bytes.length - 32);
  const signature = bytes.subarray(bytes.length - 32);
  const hmacKey = await crypto.subtle.importKey("raw", signing, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("HMAC", hmacKey, signature, unsigned)) {
    throw new Error("Invalid encrypted email payload");
  }
  const iv = bytes.subarray(9, 25);
  const ciphertext = bytes.subarray(25, bytes.length - 32);
  const aesKey = await crypto.subtle.importKey("raw", encryption, "AES-CBC", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, aesKey, ciphertext);
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}

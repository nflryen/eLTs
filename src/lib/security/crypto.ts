/**
 * Uses the Web Crypto API to securely hash a string (e.g., PIN).
 * Compatible with Edge runtime (Middleware).
 *
 * @param text The string to hash
 * @returns The SHA-256 hash in hex format
 */
export async function hashPin(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}

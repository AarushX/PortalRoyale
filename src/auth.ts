/**
 * Verification of the `Nexus-Token` header on inbound webhook requests.
 *
 * Nexus push webhooks send a caller-defined token in the `Nexus-Token`
 * header (the same value you configure when creating the webhook in Nexus).
 * We compare it against our stored secret using a length-safe, constant-time
 * comparison to avoid leaking the secret via timing.
 */

export function verifyNexusToken(
  headers: Headers,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  const provided = headers.get("Nexus-Token") ?? headers.get("nexus-token");
  if (!provided) return false;
  return timingSafeEqual(provided, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Compare against a fixed length so the loop count never depends on the
  // provided value's length. Mismatched lengths still fail.
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

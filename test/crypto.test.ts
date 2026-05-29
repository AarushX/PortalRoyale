import { describe, it, expect } from "vitest";
import { encryptJson, decryptJson, randomId, randomToken } from "../src/crypto.js";

describe("crypto", () => {
  it("round-trips an encrypted JSON value", async () => {
    const secret = "test-secret-key";
    const value = { token: "pk_abc", n: 42, nested: { a: [1, 2, 3] } };
    const blob = await encryptJson(value, secret);
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain("pk_abc"); // ciphertext, not plaintext
    expect(await decryptJson(blob, secret)).toEqual(value);
  });

  it("fails to decrypt with the wrong key", async () => {
    const blob = await encryptJson({ x: 1 }, "right");
    await expect(decryptJson(blob, "wrong")).rejects.toThrow();
  });

  it("rejects malformed ciphertext", async () => {
    await expect(decryptJson("not-a-blob", "k")).rejects.toThrow(/malformed/);
  });

  it("generates ids of the expected shape", () => {
    expect(randomId(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomId()).not.toBe(randomId());
    expect(randomToken()).not.toMatch(/[+/=]/); // url-safe
  });
});

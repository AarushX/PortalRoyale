import { describe, it, expect } from "vitest";
import { buildAuthorizeUrl } from "../src/oauth/clickup.js";

describe("buildAuthorizeUrl", () => {
  it("includes client_id, redirect_uri and state", () => {
    const url = new URL(
      buildAuthorizeUrl("cid123", "https://app.example.com/oauth/clickup/callback", "st8"),
    );
    expect(url.origin + url.pathname).toBe("https://app.clickup.com/api");
    expect(url.searchParams.get("client_id")).toBe("cid123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/oauth/clickup/callback",
    );
    expect(url.searchParams.get("state")).toBe("st8");
  });
});

import { describe, it, expect } from "vitest";
import { generateRelayToken, isAuthorizedToken } from "../relay-auth.js";

describe("M82-RELAY auth", () => {
  it("BR-F-120: generates non-empty relay token", () => {
    const token = generateRelayToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(10);
  });

  it("BR-F-121: rejects unauthorized token and accepts exact match", () => {
    const token = "abc123";
    expect(isAuthorizedToken(null, token)).toBe(false);
    expect(isAuthorizedToken("wrong", token)).toBe(false);
    expect(isAuthorizedToken("abc123", token)).toBe(true);
  });
});

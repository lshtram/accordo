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

  describe("isAuthorizedToken edge cases", () => {
    const validToken = "abc123def456";

    it("AUTH-01-edge: rejects undefined candidate", () => {
      expect(isAuthorizedToken(undefined, validToken)).toBe(false);
    });

    it("AUTH-01-edge: rejects null candidate", () => {
      expect(isAuthorizedToken(null, validToken)).toBe(false);
    });

    it("AUTH-01-edge: rejects empty string candidate", () => {
      expect(isAuthorizedToken("", validToken)).toBe(false);
    });

    it("AUTH-01-edge: rejects candidate shorter than expected", () => {
      expect(isAuthorizedToken("abc", validToken)).toBe(false);
    });

    it("AUTH-01-edge: rejects candidate longer than expected", () => {
      expect(isAuthorizedToken("abc123def4567", validToken)).toBe(false);
    });

    it("AUTH-01-edge: accepts exact-length candidate that matches", () => {
      expect(isAuthorizedToken(validToken, validToken)).toBe(true);
    });

    it("AUTH-01-edge: rejects exact-length candidate with wrong content", () => {
      // Same length but all wrong bytes — must still be rejected and not short-circuit
      const wrong = "xxxxxxxxxxxx"; // same length as validToken (12)
      expect(isAuthorizedToken(wrong, validToken)).toBe(false);
    });

    it("AUTH-01-edge: candidate with same prefix but different suffix is rejected", () => {
      const valid = "abc123def456";
      const almost = "abc123def457"; // differs only in last byte
      expect(isAuthorizedToken(almost, valid)).toBe(false);
    });

    it("AUTH-01-edge: non-string candidate types are rejected", () => {
      expect(isAuthorizedToken(123 as unknown as string, validToken)).toBe(false);
      expect(isAuthorizedToken({} as unknown as string, validToken)).toBe(false);
      expect(isAuthorizedToken([] as unknown as string, validToken)).toBe(false);
    });
  });

  describe("generateRelayToken quality", () => {
    it("generates a UUID-formatted string", () => {
      const token = generateRelayToken();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(token).toMatch(uuidRegex);
    });

    it("generates unique tokens on successive calls", () => {
      const token1 = generateRelayToken();
      const token2 = generateRelayToken();
      expect(token1).not.toBe(token2);
    });
  });
});

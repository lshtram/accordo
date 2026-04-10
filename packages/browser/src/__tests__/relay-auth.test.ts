import { describe, it, expect } from "vitest";
import { isAuthorizedToken } from "../relay-auth.js";

describe("AUTH-01: isAuthorizedToken", () => {
  it("returns true for matching ASCII tokens", () => {
    expect(isAuthorizedToken("my-secret-token", "my-secret-token")).toBe(true);
  });

  it("returns false for non-matching ASCII tokens", () => {
    expect(isAuthorizedToken("wrong-token", "my-secret-token")).toBe(false);
  });

  it("returns false for empty or null candidate", () => {
    expect(isAuthorizedToken(null, "my-secret-token")).toBe(false);
    expect(isAuthorizedToken(undefined, "my-secret-token")).toBe(false);
    expect(isAuthorizedToken("", "my-secret-token")).toBe(false);
  });

  it("returns false for length-mismatched candidate", () => {
    expect(isAuthorizedToken("short", "my-secret-token")).toBe(false);
    expect(isAuthorizedToken("my-secret-token-extra", "my-secret-token")).toBe(false);
  });

  it("returns false for Unicode multi-byte input (same JS length, different byte length)", () => {
    // timingSafeEqual throws ERR_INVALID_BUFFER_SIZE when byte lengths differ.
    // A hostile client could send a token with the same JS-string length as the
    // expected token but different UTF-8 encoding (e.g. "\u00e9" vs "a" both have
    // JS length 1 but byte lengths 2 vs 1).  isAuthorizedToken must not throw.
    const multiByteCandidate = "\u00e9"; // "é" — JS length 1, byte length 2
    const expected = "a";                 // JS length 1, byte length 1

    expect(() => isAuthorizedToken(multiByteCandidate, expected)).not.toThrow();
    expect(isAuthorizedToken(multiByteCandidate, expected)).toBe(false);
  });

  it("returns true for matching non-ASCII tokens with equal byte lengths", () => {
    // When byte lengths are equal, timingSafeEqual works normally.
    expect(isAuthorizedToken("\u00e9\u00e9", "\u00e9\u00e9")).toBe(true);
  });
});

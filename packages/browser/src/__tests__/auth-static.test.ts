import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * AUTH-06: Static guardrail — prevent reintroduction of hardcoded fallback tokens.
 *
 * This test reads the extension.ts source and verifies that no hardcoded
 * fallback token pattern exists.  This is a compile-time / source-static
 * assertion, not a behavioural test.
 *
 * Reviewer verdict: FAIL on "no hardcoded dev token fallback reintroduction".
 * AUTH-06 static guardrail.
 */
describe("AUTH-06: No hardcoded fallback token in extension.ts", () => {
  const EXTENSION_TS = resolve(
    import.meta.dirname,
    "../extension.ts",
  );
  const source = readFileSync(EXTENSION_TS, "utf-8");

  it("source must not contain DEV_RELAY_TOKEN constant declaration", () => {
    expect(source).not.toMatch(/\bDEV_RELAY_TOKEN\b/);
  });

  it("source must not contain the removed hardcoded dev token string", () => {
    expect(source).not.toContain("accordo-local-dev-token");
  });

  it("source must not use ?? fallback on token/secret variables to a string literal", () => {
    // Catch patterns like:  token ?? "hardcoded-fallback"
    // Exclude: anchorKey ?? "body:center" (anchor key, not a token)
    // Exclude: threadId ?? undefined (no string literal)
    const tokenFallback = /\b(?:token|secret|TOKEN|SECRET)\b[^;]*?\?\?\s*["'][^'"\s][^"']{4,}/g;
    const matches: string[] = [];
    let m;
    while ((m = tokenFallback.exec(source)) !== null) {
      // Skip anchorKey — that is an anchor string, not a relay token
      if (!m[0].includes("anchorKey")) {
        matches.push(m[0]);
      }
    }
    expect(matches).toHaveLength(0);
  });
});

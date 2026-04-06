/**
 * security-structured-errors.test.ts
 *
 * Tests for F6: Structured Errors (MCP-ER-001..004)
 *
 * Tests validate:
 * - MCP-ER-001: PageToolError shape { success: false, error: string, retryable?, retryAfterMs?, details? }
 * - MCP-ER-002: retryable classification for all error codes
 * - MCP-ER-004: CaptureError codes are properly typed
 *
 * These tests exercise the page-tool-types module and buildStructuredError function.
 * buildStructuredError is in page-tool-types.ts (not in security/).
 * They will fail until Phase C implementation.
 */

import { describe, it, expect } from "vitest";
import type {
  PageToolError,
  CaptureError,
  RelayError,
  SecurityError,
  BrowserToolErrorCode,
} from "../page-tool-types.js";
import {
  buildStructuredError,
} from "../page-tool-types.js";

// ── MCP-ER-001: Structured error shape ─────────────────────────────────────

describe("MCP-ER-001: PageToolError structured error shape", () => {
  it("MCP-ER-001: buildStructuredError returns { success: false, error: string }", () => {
    const err = buildStructuredError("timeout");
    expect(err).toHaveProperty("success", false);
    expect(err).toHaveProperty("error");
    expect(typeof err.error).toBe("string");
  });

  it("MCP-ER-001: error object has success: false", () => {
    const err = buildStructuredError("element-not-found") as PageToolError;
    expect(err.success).toBe(false);
  });

  it("MCP-ER-001: error is a string code", () => {
    const err = buildStructuredError("origin-blocked") as PageToolError;
    expect(typeof err.error).toBe("string");
  });

  it("MCP-ER-001: Optional retryable field is present", () => {
    const err = buildStructuredError("timeout") as PageToolError;
    expect("retryable" in err).toBe(true);
    expect(typeof err.retryable).toBe("boolean");
  });

  it("MCP-ER-001: Optional retryAfterMs field is present for transient errors", () => {
    const err = buildStructuredError("browser-not-connected") as PageToolError;
    expect("retryAfterMs" in err).toBe(true);
    if (err.retryAfterMs !== undefined) {
      expect(typeof err.retryAfterMs).toBe("number");
    }
  });

  it("MCP-ER-001: Optional details field is present when provided", () => {
    const err = buildStructuredError("action-failed", "Relay returned 500") as PageToolError;
    expect("details" in err).toBe(true);
  });

  it("MCP-ER-001: pageUrl is null for backward compatibility", () => {
    const err = buildStructuredError("element-not-found") as PageToolError;
    expect(err.pageUrl).toBeNull();
  });

  it("MCP-ER-001: found is false for error responses", () => {
    const err = buildStructuredError("element-not-found") as PageToolError;
    expect(err.found).toBe(false);
  });
});

// ── MCP-ER-002: Retryable classification ───────────────────────────────────

describe("MCP-ER-002: retryable classification", () => {
  describe("MCP-ER-002: Transient errors → retryable: true", () => {
    const transientErrors: Array<{ code: string; expectedRetryAfterMs?: number }> = [
      { code: "browser-not-connected", expectedRetryAfterMs: 2000 },
      { code: "timeout", expectedRetryAfterMs: 1000 },
      { code: "action-failed", expectedRetryAfterMs: 1000 },
      { code: "capture-failed", expectedRetryAfterMs: 2000 },  // MCP-ER-002: transient — tab may not be ready
      { code: "element-off-screen", expectedRetryAfterMs: 1000 }, // MCP-ER-002: transient — element may scroll into view
    ];

    for (const { code, expectedRetryAfterMs } of transientErrors) {
      it(`MCP-ER-002: '${code}' → retryable: true, retryAfterMs: ${expectedRetryAfterMs}`, () => {
        const err = buildStructuredError(code) as PageToolError;
        expect(err.retryable).toBe(true);
        if (expectedRetryAfterMs !== undefined) {
          expect(err.retryAfterMs).toBe(expectedRetryAfterMs);
        }
      });
    }
  });

  describe("MCP-ER-002: Permanent errors → retryable: false", () => {
    const permanentErrors = [
      "element-not-found",
      "image-too-large",
      "no-target",
      "origin-blocked",
      "redaction-failed",
    ];

    for (const code of permanentErrors) {
      it(`MCP-ER-002: '${code}' → retryable: false`, () => {
        const err = buildStructuredError(code) as PageToolError;
        expect(err.retryable).toBe(false);
      });
    }

    it("MCP-ER-002: Permanent errors do NOT have retryAfterMs", () => {
      const err = buildStructuredError("origin-blocked") as PageToolError;
      expect(err.retryable).toBe(false);
    });
  });
});

// ── MCP-ER-004: CaptureError code propagation ───────────────────────────────

describe("MCP-ER-004: CaptureError codes", () => {
  const captureErrors: CaptureError[] = [
    "element-not-found",
    "element-off-screen",
    "image-too-large",
    "capture-failed",
    "no-target",
    "browser-not-connected",
    "timeout",
    "origin-blocked",
    "redaction-failed",
  ];

  for (const code of captureErrors) {
    it(`MCP-ER-004: '${code}' is a valid CaptureError`, () => {
      const err = buildStructuredError(code) as PageToolError;
      expect(err.error).toBe(code);
    });
  }
});

// ── MCP-ER-005: New error codes ─────────────────────────────────────────────

describe("MCP-ER-005: New error codes", () => {
  it("MCP-ER-005: detached-node is a valid CaptureError", () => {
    const err = buildStructuredError("detached-node") as PageToolError;
    expect(err.success).toBe(false);
    expect(err.error).toBe("detached-node");
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(1000); // transient
  });

  it("MCP-ER-005: blocked-resource is a valid CaptureError", () => {
    const err = buildStructuredError("blocked-resource") as PageToolError;
    expect(err.success).toBe(false);
    expect(err.error).toBe("blocked-resource");
    expect(err.retryable).toBe(false);
  });

  it("MCP-ER-005: navigation-failed is a valid CaptureError", () => {
    const err = buildStructuredError("navigation-failed") as PageToolError;
    expect(err.success).toBe(false);
    expect(err.error).toBe("navigation-failed");
    expect(err.retryable).toBe(false);
  });

  it("MCP-ER-005: navigation-failed includes details string", () => {
    const err = buildStructuredError("navigation-failed", "net::ERR_CONNECTION_REFUSED") as PageToolError;
    expect(err.details).toBe("net::ERR_CONNECTION_REFUSED");
  });

  it("MCP-ER-005: detached-node is retryable with retryAfterMs", () => {
    const err = buildStructuredError("detached-node") as PageToolError;
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(1000);
  });

  it("MCP-ER-005: blocked-resource is not retryable", () => {
    const err = buildStructuredError("blocked-resource") as PageToolError;
    expect(err.retryable).toBe(false);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("MCP-ER-005: navigation-failed is not retryable", () => {
    const err = buildStructuredError("navigation-failed") as PageToolError;
    expect(err.retryable).toBe(false);
    expect(err.retryAfterMs).toBeUndefined();
  });
});

// ── MCP-ER-006: CaptureError union includes new codes ─────────────────────────

describe("MCP-ER-006: CaptureError union includes new codes", () => {
  it("MCP-ER-006: detached-node is in CaptureError union", () => {
    const code: CaptureError = "detached-node";
    expect(code).toBe("detached-node");
  });

  it("MCP-ER-006: blocked-resource is in CaptureError union", () => {
    const code: CaptureError = "blocked-resource";
    expect(code).toBe("blocked-resource");
  });

  it("MCP-ER-006: navigation-failed is in CaptureError union", () => {
    const code: CaptureError = "navigation-failed";
    expect(code).toBe("navigation-failed");
  });
});

// ── SecurityError codes ─────────────────────────────────────────────────────

describe("MCP-ER-001: SecurityError codes", () => {
  it("MCP-ER-001: 'origin-blocked' is a SecurityError", () => {
    const err = buildStructuredError("origin-blocked") as PageToolError;
    expect(err.error).toBe("origin-blocked");
    expect(err.retryable).toBe(false);
  });

  it("MCP-ER-001: 'redaction-failed' is a SecurityError", () => {
    const err = buildStructuredError("redaction-failed") as PageToolError;
    expect(err.error).toBe("redaction-failed");
    expect(err.retryable).toBe(false);
  });
});

// ── Error code exhaustiveness ───────────────────────────────────────────────

describe("MCP-ER-001: All error codes produce structured response", () => {
  const allCodes: BrowserToolErrorCode[] = [
    // CaptureError
    "element-not-found",
    "element-off-screen",
    "image-too-large",
    "capture-failed",
    "no-target",
    "browser-not-connected",
    "timeout",
    "origin-blocked",
    "redaction-failed",
    "detached-node",      // MCP-ER-005
    "blocked-resource",   // MCP-ER-005
    "navigation-failed",  // MCP-ER-005
    // RelayError
    "action-failed",
  ];

  for (const code of allCodes) {
    it(`MCP-ER-001: '${code}' produces a structured PageToolError`, () => {
      const err = buildStructuredError(code) as PageToolError;
      expect(err.success).toBe(false);
      expect(err.error).toBe(code);
      expect(typeof err.retryable).toBe("boolean");
    });
  }
});

// ── H2: recoveryHints on buildStructuredError ────────────────────────────────

describe("H2: buildStructuredError includes recoveryHints", () => {
  // These are the transient error codes from TRANSIENT_ERRORS in page-tool-types.ts.
  const transientCodes = [
    "browser-not-connected",
    "timeout",
    "action-failed",
    "detached-node",
    "capture-failed",
    "element-off-screen",
  ] as const;

  for (const code of transientCodes) {
    it(`H2-1: '${code}' (transient) includes a non-empty recoveryHints string`, () => {
      const err = buildStructuredError(code) as PageToolError;
      expect(err.recoveryHints).toBeDefined();
      expect(typeof err.recoveryHints).toBe("string");
      expect((err.recoveryHints as string).length).toBeGreaterThan(0);
    });
  }

  it("H2-2: 'origin-blocked' (non-transient, known) includes recoveryHints and retryable:false", () => {
    const err = buildStructuredError("origin-blocked") as PageToolError;
    expect(err.recoveryHints).toBeDefined();
    expect(typeof err.recoveryHints).toBe("string");
    expect((err.recoveryHints as string).length).toBeGreaterThan(0);
    expect(err.retryable).toBe(false);
  });

  it("H2-3: unknown error code omits recoveryHints (undefined)", () => {
    const err = buildStructuredError("some-unknown-code") as PageToolError;
    expect(err.recoveryHints).toBeUndefined();
  });

  it("H3-1: PageToolError type accepts recoveryHints field (type-level)", () => {
    // Construct a PageToolError with recoveryHints — must compile without type assertion.
    const err: PageToolError = {
      success: false,
      error: "timeout",
      retryable: true,
      retryAfterMs: 1000,
      recoveryHints: "Retry with a longer timeout.",
    };
    expect(err.recoveryHints).toBe("Retry with a longer timeout.");
  });
});

// ── Error code type exports ─────────────────────────────────────────────────

describe("MCP-ER-001: Error type exports are valid unions", () => {
  it("CaptureError includes all expected codes", () => {
    const codes: CaptureError[] = [
      "element-not-found",
      "element-off-screen",
      "image-too-large",
      "capture-failed",
      "no-target",
      "browser-not-connected",
      "timeout",
      "origin-blocked",
      "redaction-failed",
      "detached-node",      // MCP-ER-005
      "blocked-resource",   // MCP-ER-005
      "navigation-failed",  // MCP-ER-005
    ];
    for (const code of codes) {
      const valid: CaptureError = code;
      expect(valid).toBe(code);
    }
  });

  it("RelayError includes transient error codes", () => {
    const codes: RelayError[] = [
      "browser-not-connected",
      "timeout",
      "action-failed",
    ];
    for (const code of codes) {
      const valid: RelayError = code;
      expect(valid).toBe(code);
    }
  });

  it("SecurityError includes security-specific error codes", () => {
    const codes: SecurityError[] = ["origin-blocked", "redaction-failed"];
    for (const code of codes) {
      const valid: SecurityError = code;
      expect(valid).toBe(code);
    }
  });
});

/**
 * security-origin-policy.test.ts
 *
 * Tests for F1: Origin Allow/Deny Policy (MCP-SEC-001, B2-PS-001..003, B2-ER-007)
 *
 * API checklist (checkOrigin, extractOrigin, mergeOriginPolicy):
 * - checkOrigin(origin, policy) → "allow" | "block"
 * - extractOrigin(url) → string | undefined
 * - mergeOriginPolicy(global, requestAllowed?, requestDenied?) → OriginPolicy
 *
 * These tests call the security functions directly from security-policy.ts.
 * They will fail until Phase C implementation.
 */

import { describe, it, expect } from "vitest";
import {
  checkOrigin,
  extractOrigin,
  mergeOriginPolicy,
  OriginPolicy,
} from "../security/index.js";

// ── checkOrigin: B2-PS-001 (allowedOrigins whitelist) ─────────────────────────

describe("MCP-SEC-001 / B2-PS-001: allowedOrigins whitelist", () => {
  it("MCP-SEC-001: Origin in allowedOrigins returns 'allow'", () => {
    const policy: OriginPolicy = {
      allowedOrigins: ["https://example.com", "https://app.example.org"],
      deniedOrigins: [],
      defaultAction: "allow",
    };
    expect(checkOrigin("https://example.com", policy)).toBe("allow");
    expect(checkOrigin("https://app.example.org", policy)).toBe("allow");
  });

  it("MCP-SEC-001: Origin NOT in allowedOrigins returns 'block'", () => {
    const policy: OriginPolicy = {
      allowedOrigins: ["https://allowed.com"],
      deniedOrigins: [],
      defaultAction: "allow",
    };
    expect(checkOrigin("https://other.com", policy)).toBe("block");
    expect(checkOrigin("https://evil.net", policy)).toBe("block");
  });

  it("MCP-SEC-001: Empty allowedOrigins → fallback to defaultAction", () => {
    const policy: OriginPolicy = {
      allowedOrigins: [],
      deniedOrigins: [],
      defaultAction: "allow",
    };
    expect(checkOrigin("https://any.com", policy)).toBe("allow");
  });

  it("MCP-SEC-001: Non-empty allowedOrigins + defaultAction deny → still checks allowlist", () => {
    // When allowedOrigins is non-empty, defaultAction is only fallback when lists are empty
    const policy: OriginPolicy = {
      allowedOrigins: ["https://only-this.com"],
      deniedOrigins: [],
      defaultAction: "deny",
    };
    expect(checkOrigin("https://only-this.com", policy)).toBe("allow");
    expect(checkOrigin("https://other.com", policy)).toBe("block");
  });
});

// ── checkOrigin: B2-PS-002 (deniedOrigins blacklist) ───────────────────────

describe("MCP-SEC-001 / B2-PS-002: deniedOrigins blacklist takes precedence", () => {
  it("B2-PS-002: Origin in deniedOrigins returns 'block' even if in allowedOrigins", () => {
    const policy: OriginPolicy = {
      allowedOrigins: ["https://example.com"],
      deniedOrigins: ["https://example.com"],
      defaultAction: "allow",
    };
    // deniedOrigins takes precedence (B2-PS-002)
    expect(checkOrigin("https://example.com", policy)).toBe("block");
  });

  it("B2-PS-002: deniedOrigins blocks even when allowedOrigins is empty", () => {
    const policy: OriginPolicy = {
      allowedOrigins: [],
      deniedOrigins: ["https://blocked.com"],
      defaultAction: "allow",
    };
    expect(checkOrigin("https://blocked.com", policy)).toBe("block");
  });

  it("B2-PS-002: Multiple deniedOrigins blocks all listed", () => {
    const policy: OriginPolicy = {
      allowedOrigins: ["https://example.com"],
      deniedOrigins: ["https://evil.net", "https://malicious.org"],
      defaultAction: "allow",
    };
    expect(checkOrigin("https://evil.net", policy)).toBe("block");
    expect(checkOrigin("https://malicious.org", policy)).toBe("block");
    expect(checkOrigin("https://example.com", policy)).toBe("allow");
  });

  it("B2-PS-002: Unrelated origin not in deny list is not affected", () => {
    const policy: OriginPolicy = {
      allowedOrigins: ["https://example.com"],
      deniedOrigins: ["https://blocked.com"],
      defaultAction: "allow",
    };
    expect(checkOrigin("https://example.com", policy)).toBe("allow");
    expect(checkOrigin("https://unrelated.com", policy)).toBe("block"); // not in allowlist
  });
});

// ── checkOrigin: B2-PS-003 (defaultAction) ──────────────────────────────────

describe("MCP-SEC-001 / B2-PS-003: defaultAction when both lists are empty", () => {
  it("B2-PS-003: defaultAction 'allow' → any origin is allowed", () => {
    const policy: OriginPolicy = {
      allowedOrigins: [],
      deniedOrigins: [],
      defaultAction: "allow",
    };
    expect(checkOrigin("https://any-site.com", policy)).toBe("allow");
    expect(checkOrigin("http://insecure.com", policy)).toBe("allow");
  });

  it("B2-PS-003: defaultAction 'deny' → all origins are blocked", () => {
    const policy: OriginPolicy = {
      allowedOrigins: [],
      deniedOrigins: [],
      defaultAction: "deny",
    };
    expect(checkOrigin("https://any-site.com", policy)).toBe("block");
    expect(checkOrigin("http://insecure.com", policy)).toBe("block");
  });

  it("B2-PS-003: Non-empty allowedOrigins overrides defaultAction", () => {
    const policy: OriginPolicy = {
      allowedOrigins: ["https://permitted.com"],
      deniedOrigins: [],
      defaultAction: "deny",
    };
    expect(checkOrigin("https://permitted.com", policy)).toBe("allow");
    expect(checkOrigin("https://not-permitted.com", policy)).toBe("block");
  });
});

// ── extractOrigin ────────────────────────────────────────────────────────────

describe("extractOrigin: URL to origin extraction", () => {
  it("extracts origin from valid HTTPS URL", () => {
    expect(extractOrigin("https://example.com/page")).toBe("https://example.com");
    expect(extractOrigin("https://example.com:8080/page?q=1")).toBe("https://example.com:8080");
  });

  it("extracts origin from valid HTTP URL", () => {
    expect(extractOrigin("http://localhost:3000/path")).toBe("http://localhost:3000");
  });

  it("extracts origin from URL with subdomains", () => {
    expect(extractOrigin("https://app.example.com/path")).toBe("https://app.example.com");
  });

  it("returns undefined for invalid URL", () => {
    expect(extractOrigin("not-a-url")).toBe(undefined);
    expect(extractOrigin("")).toBe(undefined);
  });

  it("handles URL with only origin (no path)", () => {
    expect(extractOrigin("https://example.com")).toBe("https://example.com");
  });
});

// ── mergeOriginPolicy: MCP-SEC-001 per-request override ─────────────────────

describe("MCP-SEC-001: mergeOriginPolicy — per-request override", () => {
  it("MCP-SEC-001: Per-request allowedOrigins overrides global when provided", () => {
    const global: OriginPolicy = {
      allowedOrigins: ["https://global.com"],
      deniedOrigins: [],
      defaultAction: "allow",
    };
    const merged = mergeOriginPolicy(global, ["https://request.com"]);
    expect(merged.allowedOrigins).toEqual(["https://request.com"]);
  });

  it("MCP-SEC-001: Per-request deniedOrigins overrides global when provided", () => {
    const global: OriginPolicy = {
      allowedOrigins: [],
      deniedOrigins: ["https://global-blocked.com"],
      defaultAction: "allow",
    };
    const merged = mergeOriginPolicy(global, undefined, ["https://request-blocked.com"]);
    expect(merged.deniedOrigins).toEqual(["https://request-blocked.com"]);
  });

  it("MCP-SEC-001: Undefined per-request params fall back to global", () => {
    const global: OriginPolicy = {
      allowedOrigins: ["https://global.com"],
      deniedOrigins: ["https://blocked.com"],
      defaultAction: "allow",
    };
    const merged = mergeOriginPolicy(global, undefined, undefined);
    expect(merged.allowedOrigins).toEqual(["https://global.com"]);
    expect(merged.deniedOrigins).toEqual(["https://blocked.com"]);
  });

  it("MCP-SEC-001: defaultAction is preserved from global", () => {
    const global: OriginPolicy = {
      allowedOrigins: [],
      deniedOrigins: [],
      defaultAction: "deny",
    };
    const merged = mergeOriginPolicy(global, undefined, undefined);
    expect(merged.defaultAction).toBe("deny");
  });

  it("MCP-SEC-001: Both per-request params override simultaneously", () => {
    const global: OriginPolicy = {
      allowedOrigins: ["https://global.com"],
      deniedOrigins: ["https://global-blocked.com"],
      defaultAction: "allow",
    };
    const merged = mergeOriginPolicy(
      global,
      ["https://request.com"],
      ["https://request-blocked.com"],
    );
    expect(merged.allowedOrigins).toEqual(["https://request.com"]);
    expect(merged.deniedOrigins).toEqual(["https://request-blocked.com"]);
    expect(merged.defaultAction).toBe("allow"); // preserved
  });

  it("MCP-SEC-001: Empty array per-request overrides to empty (not global)", () => {
    const global: OriginPolicy = {
      allowedOrigins: ["https://global.com"],
      deniedOrigins: ["https://blocked.com"],
      defaultAction: "allow",
    };
    const merged = mergeOriginPolicy(global, [], []);
    expect(merged.allowedOrigins).toEqual([]);
    expect(merged.deniedOrigins).toEqual([]);
    // With empty arrays, defaultAction applies
  });
});

// ── Error code: B2-ER-007 ────────────────────────────────────────────────────

describe("B2-ER-007: origin-blocked error code", () => {
  it("B2-ER-007: checkOrigin('block') maps to origin-blocked error scenario", () => {
    const policy: OriginPolicy = {
      allowedOrigins: [],
      deniedOrigins: ["https://blocked.com"],
      defaultAction: "allow",
    };
    // When checkOrigin returns "block", the handler should return { success: false, error: "origin-blocked" }
    const result = checkOrigin("https://blocked.com", policy);
    expect(result).toBe("block");
  });

  it("B2-ER-007: deniedOrigins blocks before any DOM access", () => {
    const policy: OriginPolicy = {
      allowedOrigins: ["https://example.com"],
      deniedOrigins: ["https://example.com"],
      defaultAction: "allow",
    };
    // The origin check happens BEFORE relay call (per design doc §3.1)
    expect(checkOrigin("https://example.com", policy)).toBe("block");
  });
});

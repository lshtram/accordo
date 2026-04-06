/**
 * security-redaction.test.ts
 *
 * Tests for F2: PII Text Redaction (MCP-SEC-002, B2-PS-004..005)
 * Tests for F3: Fail-Closed Redaction (MCP-SEC-003, B2-ER-008)
 *
 * API checklist (redactText, redactTextMapResponse, redactSemanticGraphResponse, compileRedactionPatterns):
 * - redactText(text, policy) → RedactionResult
 * - redactTextMapResponse(response, policy) → boolean
 * - redactSemanticGraphResponse(response, policy) → boolean
 * - compileRedactionPatterns(policy) → RegExp[]
 *
 * These tests call the security functions directly from redaction.ts.
 * They will fail until Phase C implementation.
 */

import { describe, it, expect } from "vitest";
import {
  redactText,
  redactTextMapResponse,
  redactSemanticGraphResponse,
  compileRedactionPatterns,
  RedactionPolicy,
  RedactionResult,
  DEFAULT_REDACTION_PATTERNS,
} from "../security/index.js";

// ── redactText: B2-PS-004 (pattern-based replacement) ────────────────────────

describe("MCP-SEC-002 / B2-PS-004: redactText — pattern-based PII replacement", () => {
  const policy: RedactionPolicy = {
    redactPatterns: DEFAULT_REDACTION_PATTERNS,
    replacement: "[REDACTED]",
  };

  it("B2-PS-004: Email addresses are replaced with [REDACTED]", () => {
    const result = redactText("Contact me at user@example.com for help", policy);
    expect(result.text).not.toContain("user@example.com");
    expect(result.text).toContain("[REDACTED]");
    expect(result.redactionApplied).toBe(true);
    expect(result.redactionCount).toBeGreaterThan(0);
  });

  it("B2-PS-004: Phone numbers are replaced with [REDACTED]", () => {
    const result = redactText("Call us at +1 (555) 123-4567", policy);
    expect(result.text).not.toContain("(555) 123-4567");
    expect(result.text).toContain("[REDACTED]");
    expect(result.redactionApplied).toBe(true);
    expect(result.redactionCount).toBeGreaterThan(0);
  });

  it("B2-PS-004: API key-like strings are replaced with [REDACTED]", () => {
    const result = redactText("api_key=abc123xyz789qwerty987654", policy);
    expect(result.text).not.toContain("abc123xyz789qwerty987654");
    expect(result.text).toContain("[REDACTED]");
    expect(result.redactionApplied).toBe(true);
  });

  it("B2-PS-004: Multiple PII instances in one text are all redacted", () => {
    const result = redactText(
      "Email: alice@example.com and bob@corp.org. Phone: (555) 111-2222",
      policy,
    );
    expect(result.redactionCount).toBeGreaterThanOrEqual(3);
    expect(result.text).not.toContain("alice@example.com");
    expect(result.text).not.toContain("bob@corp.org");
    expect(result.text).not.toContain("(555) 111-2222");
  });

  it("B2-PS-004: Text without PII returns unchanged text", () => {
    const result = redactText("Hello world, this is safe text.", policy);
    expect(result.text).toBe("Hello world, this is safe text.");
    expect(result.redactionApplied).toBe(false);
    expect(result.redactionCount).toBe(0);
  });

  it("B2-PS-004: Empty string returns empty with no redaction", () => {
    const result = redactText("", policy);
    expect(result.text).toBe("");
    expect(result.redactionApplied).toBe(false);
  });

  it("B2-PS-004: Result includes redactionCount of number of redactions", () => {
    const result = redactText(
      "a@b.com, c@d.com, e@f.com",
      policy,
    );
    expect(result.redactionCount).toBe(3);
  });
});

// ── redactText: custom patterns ───────────────────────────────────────────────

describe("B2-PS-004: redactText with custom patterns", () => {
  it("B2-PS-004: Custom pattern can redact SSN-like strings", () => {
    const policy: RedactionPolicy = {
      redactPatterns: [
        { name: "ssn", pattern: "\\d{3}-\\d{2}-\\d{4}" },
      ],
      replacement: "[REDACTED]",
    };
    const result = redactText("My SSN is 123-45-6789", policy);
    expect(result.text).not.toContain("123-45-6789");
    expect(result.text).toContain("[REDACTED]");
    expect(result.redactionApplied).toBe(true);
  });

  it("B2-PS-004: Custom pattern can redact credit card-like strings", () => {
    const policy: RedactionPolicy = {
      redactPatterns: [
        { name: "credit-card", pattern: "\\d{4}[- ]\\d{4}[- ]\\d{4}[- ]\\d{4}" },
      ],
      replacement: "[REDACTED]",
    };
    const result = redactText("Card: 4111-1111-1111-1111", policy);
    expect(result.text).not.toContain("4111-1111-1111-1111");
    expect(result.text).toContain("[REDACTED]");
  });
});

// ── redactTextMapResponse: B2-PS-005 (handler-level redaction) ───────────────

describe("MCP-SEC-002 / B2-PS-005: redactTextMapResponse — text map redaction", () => {
  const policy: RedactionPolicy = {
    redactPatterns: DEFAULT_REDACTION_PATTERNS,
    replacement: "[REDACTED]",
  };

  it("B2-PS-005: Email in textRaw is redacted", () => {
    const response = {
      segments: [
        {
          textRaw: "Contact us at help@example.com",
          textNormalized: "Contact us at help@example.com",
          accessibleName: undefined,
        },
      ],
    };
    const applied = redactTextMapResponse(response as any, policy);
    expect(applied).toBe(true);
    expect(response.segments[0].textRaw).not.toContain("help@example.com");
    expect(response.segments[0].textRaw).toContain("[REDACTED]");
  });

  it("B2-PS-005: Email in textNormalized is redacted", () => {
    const response = {
      segments: [
        {
          textRaw: "Hello",
          textNormalized: "Email: user@test.com",
          accessibleName: undefined,
        },
      ],
    };
    const applied = redactTextMapResponse(response as any, policy);
    expect(applied).toBe(true);
    expect(response.segments[0].textNormalized).not.toContain("user@test.com");
  });

  it("B2-PS-005: Email in accessibleName is redacted", () => {
    const response = {
      segments: [
        {
          textRaw: "Button",
          textNormalized: "Button",
          accessibleName: "Send to admin@example.com",
        },
      ],
    };
    const applied = redactTextMapResponse(response as any, policy);
    expect(applied).toBe(true);
    expect(response.segments[0].accessibleName).not.toContain("admin@example.com");
    expect(response.segments[0].accessibleName).toContain("[REDACTED]");
  });

  it("B2-PS-005: Multiple segments with PII are all redacted", () => {
    const response = {
      segments: [
        { textRaw: "Email: a@b.com", textNormalized: "Email: a@b.com", accessibleName: undefined },
        { textRaw: "Phone: (555) 999-8888", textNormalized: "Phone: (555) 999-8888", accessibleName: undefined },
        { textRaw: "Safe text", textNormalized: "Safe text", accessibleName: undefined },
      ],
    };
    const applied = redactTextMapResponse(response as any, policy);
    expect(applied).toBe(true);
    expect(response.segments[0].textRaw).not.toContain("a@b.com");
    expect(response.segments[1].textRaw).not.toContain("(555) 999-8888");
    expect(response.segments[2].textRaw).toBe("Safe text"); // unchanged
  });

  it("B2-PS-005: Returns false when no PII found", () => {
    const response = {
      segments: [
        { textRaw: "Hello world", textNormalized: "Hello world", accessibleName: undefined },
      ],
    };
    const applied = redactTextMapResponse(response as any, policy);
    expect(applied).toBe(false);
  });

  it("B2-PS-005: Empty segments array returns false", () => {
    const response = { segments: [] };
    const applied = redactTextMapResponse(response as any, policy);
    expect(applied).toBe(false);
  });
});

// ── redactSemanticGraphResponse: B2-PS-005 ───────────────────────────────────

describe("MCP-SEC-002 / B2-PS-005: redactSemanticGraphResponse — semantic graph redaction", () => {
  const policy: RedactionPolicy = {
    redactPatterns: DEFAULT_REDACTION_PATTERNS,
    replacement: "[REDACTED]",
  };

  it("B2-PS-005: Email in a11yTree node name is redacted", () => {
    const response = {
      a11yTree: [
        {
          name: "Contact admin@example.com",
          children: [],
        },
      ],
      landmarks: [],
      outline: [],
      forms: [],
    };
    const applied = redactSemanticGraphResponse(response as any, policy);
    expect(applied).toBe(true);
    expect(response.a11yTree[0].name).not.toContain("admin@example.com");
    expect(response.a11yTree[0].name).toContain("[REDACTED]");
  });

  it("B2-PS-005: Email in landmark label is redacted", () => {
    const response = {
      a11yTree: [],
      landmarks: [
        { label: "Email us at support@example.com", tag: "aside" },
      ],
      outline: [],
      forms: [],
    };
    const applied = redactSemanticGraphResponse(response as any, policy);
    expect(applied).toBe(true);
    expect(response.landmarks[0].label).not.toContain("support@example.com");
    expect(response.landmarks[0].label).toContain("[REDACTED]");
  });

  it("B2-PS-005: Email in outline heading text is redacted", () => {
    const response = {
      a11yTree: [],
      landmarks: [],
      outline: [
        { text: "Section: user@site.com", level: 2, nodeId: 1, id: undefined },
      ],
      forms: [],
    };
    const applied = redactSemanticGraphResponse(response as any, policy);
    expect(applied).toBe(true);
    expect(response.outline[0].text).not.toContain("user@site.com");
    expect(response.outline[0].text).toContain("[REDACTED]");
  });

  it("B2-PS-005: Email in form field label/value/name is redacted", () => {
    const response = {
      a11yTree: [],
      landmarks: [],
      outline: [],
      forms: [
        {
          formId: "contact-form",
          name: "Contact form",
          fields: [
            { label: "Email address", value: "user@example.com", name: "email" },
          ],
        },
      ],
    };
    const applied = redactSemanticGraphResponse(response as any, policy);
    expect(applied).toBe(true);
    expect(response.forms[0].fields[0].value).not.toContain("user@example.com");
    expect(response.forms[0].fields[0].value).toContain("[REDACTED]");
  });

  it("B2-PS-005: Nested a11yTree children are recursively redacted", () => {
    const response = {
      a11yTree: [
        {
          name: "Outer",
          children: [
            {
              name: "Inner with email inner@test.com",
              children: [],
            },
          ],
        },
      ],
      landmarks: [],
      outline: [],
      forms: [],
    };
    const applied = redactSemanticGraphResponse(response as any, policy);
    expect(applied).toBe(true);
    expect(response.a11yTree[0].children[0].name).not.toContain("inner@test.com");
    expect(response.a11yTree[0].name).toBe("Outer"); // parent unchanged (no PII)
  });

  it("B2-PS-005: Returns false when no PII found", () => {
    const response = {
      a11yTree: [{ name: "Safe content", children: [] }],
      landmarks: [{ label: "Safe landmark" }],
      outline: [{ text: "Safe heading", level: 1, nodeId: 1, id: undefined }],
      forms: [{ name: "Safe form", fields: [] }],
    };
    const applied = redactSemanticGraphResponse(response as any, policy);
    expect(applied).toBe(false);
  });
});

// ── compileRedactionPatterns: B2-ER-008 (malformed regex → fail-closed) ───────

describe("MCP-SEC-003 / B2-ER-008: compileRedactionPatterns — invalid regex throws", () => {
  it("B2-ER-008: Malformed regex pattern throws Error (triggers fail-closed)", () => {
    const policy: RedactionPolicy = {
      redactPatterns: [
        { name: "bad", pattern: "[a-z" }, // unclosed character class
      ],
      replacement: "[REDACTED]",
    };
    expect(() => compileRedactionPatterns(policy)).toThrow();
  });

  it("B2-ER-008: Valid patterns compile without error", () => {
    const policy: RedactionPolicy = {
      redactPatterns: DEFAULT_REDACTION_PATTERNS,
      replacement: "[REDACTED]",
    };
    const compiled = compileRedactionPatterns(policy);
    expect(compiled).toHaveLength(DEFAULT_REDACTION_PATTERNS.length);
    expect(compiled.every((r) => r instanceof RegExp)).toBe(true);
  });

  it("B2-ER-008: Empty patterns array returns empty array", () => {
    const policy: RedactionPolicy = { redactPatterns: [], replacement: "[REDACTED]" };
    const compiled = compileRedactionPatterns(policy);
    expect(compiled).toEqual([]);
  });
});

// ── Default patterns sanity check ────────────────────────────────────────────

describe("DEFAULT_REDACTION_PATTERNS: built-in pattern coverage", () => {
  it("DEFAULT_REDACTION_PATTERNS includes email, phone, api-key patterns", () => {
    const names = DEFAULT_REDACTION_PATTERNS.map((p) => p.name);
    expect(names).toContain("email");
    expect(names).toContain("phone");
    expect(names).toContain("api-key");
  });

  it("DEFAULT_REDACTION_PATTERNS email pattern matches common emails", () => {
    const emailPattern = DEFAULT_REDACTION_PATTERNS.find((p) => p.name === "email")!;
    const regex = new RegExp(emailPattern.pattern);
    expect("user@example.com").toMatch(regex);
    expect("test.user+label@sub.domain.org").toMatch(regex);
  });

  it("DEFAULT_REDACTION_PATTERNS phone pattern matches common phone formats", () => {
    const phonePattern = DEFAULT_REDACTION_PATTERNS.find((p) => p.name === "phone")!;
    const regex = new RegExp(phonePattern.pattern);
    expect("(555) 123-4567").toMatch(regex);
    expect("+1 555 123 4567").toMatch(regex);
    expect("555.123.4567").toMatch(regex);
  });
});

/**
 * FC-05a–e — HTML Entity Decoder Tests
 *
 * Tests cover decodeHtmlEntities() in parser/decode-html.ts.
 *
 * Handles:
 *   - Named entities (FC-05b): &amp; &lt; &gt; &quot; &#39;
 *   - Decimal numeric entities (FC-05c): &#60; &#8364;
 *   - Hex numeric entities (FC-05d): &#x3C; &#x1F600;
 *   - Unknown named entities (FC-05e): pass through unchanged
 *
 * The stub in Phase B returns input unchanged, so failures are
 * per-requirement assertion mismatches rather than a shared throw.
 * Implementation replaces the stub body in Phase C.
 *
 * Requirements: docs/20-requirements/requirements-diagram-fidelity.md FC-05a–e
 *
 * API checklist:
 *   decodeHtmlEntities — 18 tests
 *   FC-05a  function exists and is a string→string pure function — 1 test
 *   FC-05b  named entities (&amp; &lt; &gt; &quot; &#39;) decoded — 6 tests
 *   FC-05c  decimal entities (&#NNN;) decoded — 4 tests
 *   FC-05d  hex entities (&#xHHHH;) decoded — 5 tests
 *   FC-05e  unknown named entities pass through unchanged — 4 tests
 */

import { describe, it, expect } from "vitest";
import { decodeHtmlEntities } from "../parser/decode-html.js";

// ── FC-05a: function exists and has correct signature ─────────────────────────

describe("FC-05a: decodeHtmlEntities function exists", () => {
  it("FC-05a: decodeHtmlEntities is a string→string function exported from decode-html.ts", () => {
    // Structural: function exists and is callable
    expect(typeof decodeHtmlEntities).toBe("function");
    // Pure: same input always gives same output (idempotent check)
    const result1 = decodeHtmlEntities("test");
    const result2 = decodeHtmlEntities("test");
    expect(result1).toBe(result2);
  });
});

// ── FC-05b: Named HTML entities decoded ───────────────────────────────────────
// FC-05b scope: &amp; &lt; &gt; &quot; &#39;  (the 5 XML predefined entities)

describe("FC-05b: Named HTML entities decoded", () => {
  it("FC-05b.1: &amp; decodes to &", () => {
    expect(decodeHtmlEntities("A &amp; B")).toBe("A & B");
  });

  it("FC-05b.2: &lt; decodes to <", () => {
    expect(decodeHtmlEntities("&lt;div&gt;")).toBe("<div>");
  });

  it("FC-05b.3: &gt; decodes to >", () => {
    expect(decodeHtmlEntities("a &gt; b")).toBe("a > b");
  });

  it("FC-05b.4: &quot; decodes to \"", () => {
    expect(decodeHtmlEntities("&quot;quoted&quot;")).toBe('"quoted"');
  });

  it("FC-05b.5: &#39; decodes to '", () => {
    expect(decodeHtmlEntities("&#39;single&#39;")).toBe("'single'");
  });

  it("FC-05b.6: all five standard entities in one string", () => {
    expect(
      decodeHtmlEntities("&amp; &lt; &gt; &quot; &#39;")
    ).toBe('& < > " \'');
  });
});

// ── FC-05c: Decimal numeric entities decoded ───────────────────────────────────
// FC-05c scope: &#NNN; decimal format

describe("FC-05c: Decimal numeric entities decoded", () => {
  it("FC-05c.1: &#60; decodes to < (U+003C)", () => {
    expect(decodeHtmlEntities("&#60;")).toBe("<");
  });

  it("FC-05c.2: &#8364; decodes to € (Euro sign U+20AC)", () => {
    expect(decodeHtmlEntities("&#8364;")).toBe("€");
  });

  // Split from original FC-05c.3 which mixed &copy; (unknown) with &#169; (valid).
  // &copy; is NOT in FC-05b scope → passes through per FC-05e.
  // &#169; IS a valid decimal entity (FC-05c scope).
  it("FC-05c.3: &#169; decodes to © (U+00A9 copyright sign)", () => {
    expect(decodeHtmlEntities("&#169;")).toBe("©");
  });

  it("FC-05c.4: &#47; decodes to / (forward slash)", () => {
    expect(decodeHtmlEntities("&#47;")).toBe("/");
  });
});

// ── FC-05d: Hex numeric entities decoded ──────────────────────────────────────
// FC-05d scope: &#xHHHH; hex format (case-insensitive x/X)

describe("FC-05d: Hex numeric entities decoded", () => {
  it("FC-05d.1: &#x3C; decodes to < (uppercase X)", () => {
    expect(decodeHtmlEntities("&#x3C;")).toBe("<");
  });

  it("FC-05d.2: &#x3c; decodes to < (lowercase x)", () => {
    expect(decodeHtmlEntities("&#x3c;")).toBe("<");
  });

  it("FC-05d.3: &#x1F600; decodes to 😀 (GRINNING FACE emoji)", () => {
    expect(decodeHtmlEntities("&#x1F600;")).toBe("😀");
  });

  it("FC-05d.4: &#x20AC; decodes to € (Euro sign)", () => {
    expect(decodeHtmlEntities("&#x20AC;")).toBe("€");
  });

  it("FC-05d.5: mixed hex entities in a string", () => {
    expect(decodeHtmlEntities("&#x3C;div&#x3E;")).toBe("<div>");
  });
});

// ── FC-05e: Unknown named entities pass through unchanged ─────────────────────
// FC-05e scope: any named entity NOT in the FC-05b set passes through unchanged

describe("FC-05e: Unknown named entities pass through unchanged", () => {
  it("FC-05e.1: &foobar; is unchanged (&foobar; is not a standard entity)", () => {
    // &foobar; is not recognized → must pass through unchanged
    expect(decodeHtmlEntities("&foobar;")).toBe("&foobar;");
  });

  it("FC-05e.2: &copy; passes through unchanged (&copy; is not in FC-05b scope)", () => {
    // &copy; is NOT in the required set (&amp; &lt; &gt; &quot; &#39;)
    // → per FC-05e it passes through unchanged
    expect(decodeHtmlEntities("&copy; is encoded")).toBe("&copy; is encoded");
  });

  it("FC-05e.3: partial entity-like strings with no semicolon are NOT decoded", () => {
    // Plain ampersand — not an entity (no trailing semicolon)
    expect(decodeHtmlEntities("1 & 2")).toBe("1 & 2");
    // Incomplete sequence — no semicolon
    expect(decodeHtmlEntities("a &b c")).toBe("a &b c");
    // Space breaks the entity pattern
    expect(decodeHtmlEntities("& #65;")).toBe("& #65;");
  });

  it("FC-05e.4: multiple unknown entities in one string", () => {
    expect(decodeHtmlEntities("&foo; and &bar;")).toBe("&foo; and &bar;");
  });
});

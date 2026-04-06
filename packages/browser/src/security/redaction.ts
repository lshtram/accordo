/**
 * Browser MCP Security — PII Redaction Engine
 *
 * Pattern-based text redaction for email addresses, phone numbers,
 * API keys, and custom patterns. Applies redaction before data
 * leaves the MCP handler (B2-PS-005).
 *
 * Implements requirements:
 * - B2-PS-004: PII redaction in text outputs
 * - B2-PS-005: Redaction before data leaves core
 * - B2-ER-008: Fail-closed on redaction failure
 * - MCP-SEC-002: redactPII parameter
 * - MCP-SEC-003: Fail-closed behavior
 *
 * @module
 */

import type { RedactionPolicy, RedactionResult } from "./security-types.js";

// Forward-declare response types to avoid circular dependency.
// The actual types are in text-map-tool.ts and semantic-graph-tool.ts.
// Using structural typing: any object with the right shape will work.

/** Minimal shape of a TextMapResponse for redaction purposes. */
interface TextMapLike {
  segments: Array<{ textRaw: string; textNormalized: string; accessibleName?: string }>;
}

/** Minimal shape of a SemanticGraphResponse for redaction purposes. */
interface SemanticGraphLike {
  a11yTree: Array<{ name?: string; children: SemanticGraphLike["a11yTree"] }>;
  landmarks: Array<{ label?: string }>;
  outline: Array<{ text: string }>;
  forms: Array<{ name?: string; fields: Array<{ label?: string; value?: string; name?: string }> }>;
}

/** Minimal shape of a PageMapResponse for redaction purposes. */
interface PageMapLike {
  nodes: unknown[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children?: any[];
}

/** Minimal shape of an InspectElementResponse for redaction purposes. */
interface InspectElementLike {
  element?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

/** Minimal shape of a DomExcerptResponse for redaction purposes. */
interface DomExcerptLike {
  text?: string;
}

/**
 * Apply PII redaction to a single text string.
 *
 * B2-PS-004: Pattern-based replacement using configured patterns.
 * B2-ER-008: Throws on invalid pattern — caller must catch and fail-closed.
 *
 * @param text — Input text to scan for PII
 * @param policy — Redaction policy with patterns and replacement string
 * @returns RedactionResult with redacted text and metadata
 * @throws Error if a pattern fails to compile (malformed regex)
 */
export function redactText(
  text: string,
  policy: RedactionPolicy,
): RedactionResult {
  if (text.length === 0 || policy.redactPatterns.length === 0) {
    return { text, redactionApplied: false, redactionCount: 0 };
  }

  const compiled = compileRedactionPatterns(policy);
  let result = text;
  let count = 0;

  for (const regex of compiled) {
    const before = result;
    result = result.replace(regex, policy.replacement);
    if (result !== before) {
      count += (before.match(regex) ?? []).length;
    }
  }

  return {
    text: result,
    redactionApplied: count > 0,
    redactionCount: count,
  };
}

/**
 * Apply redaction to all text fields in a text map response.
 *
 * Mutates the segments array in-place for efficiency (avoids cloning
 * large arrays). Redacts `textRaw`, `textNormalized`, and `accessibleName`
 * fields on each segment.
 *
 * B2-PS-005: Redaction applied before data leaves the handler.
 *
 * @param response — TextMapResponse-like object to redact
 * @param policy — Redaction policy
 * @returns true if any redaction was applied, false otherwise
 * @throws Error if redaction fails (caller must handle fail-closed)
 */
export function redactTextMapResponse(
  response: TextMapLike,
  policy: RedactionPolicy,
): boolean {
  if (!response.segments || response.segments.length === 0) {
    return false;
  }

  let anyApplied = false;

  for (const segment of response.segments) {
    if (segment.textRaw) {
      const result = redactText(segment.textRaw, policy);
      segment.textRaw = result.text;
      if (result.redactionApplied) anyApplied = true;
    }
    if (segment.textNormalized) {
      const result = redactText(segment.textNormalized, policy);
      segment.textNormalized = result.text;
      if (result.redactionApplied) anyApplied = true;
    }
    if (segment.accessibleName !== undefined) {
      const result = redactText(segment.accessibleName, policy);
      segment.accessibleName = result.text;
      if (result.redactionApplied) anyApplied = true;
    }
  }

  return anyApplied;
}

/**
 * Apply redaction to all text fields in a semantic graph response.
 *
 * Walks the a11y tree (recursive), landmarks, outline headings,
 * and form fields. Mutates in-place.
 *
 * B2-PS-005: Redaction applied before data leaves the handler.
 *
 * @param response — SemanticGraphResponse-like object to redact
 * @param policy — Redaction policy
 * @returns true if any redaction was applied, false otherwise
 * @throws Error if redaction fails (caller must handle fail-closed)
 */
export function redactSemanticGraphResponse(
  response: SemanticGraphLike,
  policy: RedactionPolicy,
): boolean {
  let anyApplied = false;

  // Recursively redact a11y tree nodes
  function redactA11yNode(node: { name?: string; children: Array<{ name?: string; children: unknown[] }> }): void {
    if (node.name) {
      const result = redactText(node.name, policy);
      node.name = result.text;
      if (result.redactionApplied) anyApplied = true;
    }
    if (node.children) {
      for (const child of node.children) {
        redactA11yNode(child as typeof node);
      }
    }
  }

  if (response.a11yTree) {
    for (const node of response.a11yTree) {
      redactA11yNode(node as { name?: string; children: Array<{ name?: string; children: unknown[] }> });
    }
  }

  if (response.landmarks) {
    for (const landmark of response.landmarks) {
      if (landmark.label) {
        const result = redactText(landmark.label, policy);
        landmark.label = result.text;
        if (result.redactionApplied) anyApplied = true;
      }
    }
  }

  if (response.outline) {
    for (const heading of response.outline) {
      if (heading.text) {
        const result = redactText(heading.text, policy);
        heading.text = result.text;
        if (result.redactionApplied) anyApplied = true;
      }
    }
  }

  if (response.forms) {
    for (const form of response.forms) {
      if (form.name) {
        const result = redactText(form.name, policy);
        form.name = result.text;
        if (result.redactionApplied) anyApplied = true;
      }
      if (form.fields) {
        for (const field of form.fields) {
          if (field.label) {
            const result = redactText(field.label, policy);
            field.label = result.text;
            if (result.redactionApplied) anyApplied = true;
          }
          if (field.value) {
            const result = redactText(field.value, policy);
            field.value = result.text;
            if (result.redactionApplied) anyApplied = true;
          }
          if (field.name) {
            const result = redactText(field.name, policy);
            field.name = result.text;
            if (result.redactionApplied) anyApplied = true;
          }
        }
      }
    }
  }

  return anyApplied;
}

/**
 * Apply redaction to all text fields in a page map response.
 *
 * Walks the nodes array recursively (each node may have a `children`
 * array). The only text-bearing fields on page map nodes are `name` and
 * `text`. All other structural fields (pageId, snapshotId, ref, id,
 * nodeId, bbox, etc.) are NOT redacted per design rule in DEC-018 §4.2.
 *
 * Mutates the nodes array in-place.
 *
 * @param response — PageMapResponse-like object to redact
 * @param policy — Redaction policy
 * @returns true if any redaction was applied, false otherwise
 * @throws Error if redaction fails (caller must handle fail-closed)
 */
export function redactPageMapResponse(
  response: PageMapLike,
  policy: RedactionPolicy,
): boolean {
  if (!response.nodes || response.nodes.length === 0) {
    return false;
  }

  let anyApplied = false;

  function redactNode(node: Record<string, unknown>): void {
    if (typeof node.name === "string" && node.name.length > 0) {
      const r = redactText(node.name, policy);
      node.name = r.text;
      if (r.redactionApplied) anyApplied = true;
    }
    if (typeof node.text === "string" && node.text.length > 0) {
      const r = redactText(node.text, policy);
      node.text = r.text;
      if (r.redactionApplied) anyApplied = true;
    }
    // Recurse into children
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (typeof child === "object" && child !== null) {
          redactNode(child as Record<string, unknown>);
        }
      }
    }
  }

  for (const node of response.nodes) {
    if (typeof node === "object" && node !== null) {
      redactNode(node as Record<string, unknown>);
    }
  }

  return anyApplied;
}

/**
 * Apply redaction to all text fields in an inspect element response.
 *
 * Redacts `name`, `textContent`, `ariaLabel`, `placeholder` on the element
 * and context objects. Does NOT redact identifiers, roles, states, or
 * geometry fields.
 *
 * Mutates element and context in-place.
 *
 * @param response — InspectElementResponse-like object to redact
 * @param policy — Redaction policy
 * @returns true if any redaction was applied, false otherwise
 * @throws Error if redaction fails (caller must handle fail-closed)
 */
export function redactInspectElementResponse(
  response: InspectElementLike,
  policy: RedactionPolicy,
): boolean {
  let anyApplied = false;

  function redactTextFields(obj: Record<string, unknown>): void {
    for (const key of Object.keys(obj)) {
      if (
        (key === "name" ||
          key === "textContent" ||
          key === "ariaLabel" ||
          key === "placeholder" ||
          key === "accessibleName") &&
        typeof obj[key] === "string" &&
        (obj[key] as string).length > 0
      ) {
        const result = redactText(obj[key] as string, policy);
        obj[key] = result.text;
        if (result.redactionApplied) anyApplied = true;
      }
    }
  }

  if (response.element) {
    redactTextFields(response.element);
  }
  if (response.context) {
    redactTextFields(response.context);
  }

  return anyApplied;
}

/**
 * Apply redaction to the text field in a DOM excerpt response.
 *
 * The `text` field is the only text-bearing field in DomExcerptResponse.
 * The `html` field is intentionally not redacted per DEC-018 §4.2 (markup
 * is structural, not content-bearing).
 *
 * Mutates the response in-place.
 *
 * @param response — DomExcerptResponse-like object to redact
 * @param policy — Redaction policy
 * @returns true if any redaction was applied, false otherwise
 * @throws Error if redaction fails (caller must handle fail-closed)
 */
export function redactDomExcerptResponse(
  response: DomExcerptLike,
  policy: RedactionPolicy,
): boolean {
  if (!response.text || response.text.length === 0) {
    return false;
  }

  const result = redactText(response.text, policy);
  response.text = result.text;
  return result.redactionApplied;
}

/**
 * Compile redaction patterns from string form to RegExp objects.
 * Validates that all patterns are valid regexes.
 *
 * @param policy — Redaction policy with pattern strings
 * @returns Array of compiled RegExp objects
 * @throws Error if any pattern is invalid (B2-ER-008: triggers fail-closed)
 */
export function compileRedactionPatterns(
  policy: RedactionPolicy,
): RegExp[] {
  return policy.redactPatterns.map((p) => new RegExp(p.pattern, "gi"));
}

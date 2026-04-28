/**
 * security/redaction.ts — Pattern Compilation
 *
 * Core redactText function and pattern compiler for PII redaction.
 *
 * @module
 */

import type { RedactionPolicy, RedactionResult } from "./security-types.js";

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
export function redactText(text: string, policy: RedactionPolicy): RedactionResult {
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
 * Compile redaction patterns from string form to RegExp objects.
 * Validates that all patterns are valid regexes.
 *
 * @param policy — Redaction policy with pattern strings
 * @returns Array of compiled RegExp objects
 * @throws Error if any pattern is invalid (B2-ER-008: triggers fail-closed)
 */
export function compileRedactionPatterns(policy: RedactionPolicy): RegExp[] {
  return policy.redactPatterns.map((p) => new RegExp(p.pattern, "gi"));
}

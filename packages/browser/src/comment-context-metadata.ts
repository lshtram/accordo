/**
 * comment-context-metadata.ts — Metadata comparison helpers.
 *
 * Extracted from comment-context-helpers.ts for modularity.
 * Each helper <= 30 lines.
 *
 * @module
 */

import { isFoundResult, isPageToolError, normalizeComparableText } from "./comment-context-common.js";

// ── Frame-Agnostic Recovery ──────────────────────────────────────────────────

export function shouldRetryFrameAgnosticRecovery(
  anchorKey: string,
  inspect: unknown,
  excerpt: unknown,
): boolean {
  if (isPageToolError(inspect) || isPageToolError(excerpt)) return true;
  if (isFoundResult(inspect) && isFoundResult(excerpt) && inspect.found === false && excerpt.found === false) return true;
  if (!anchorKey.startsWith("body:")) return false;
  return (
    typeof inspect === "object" &&
    inspect !== null &&
    (((inspect as InspectElementShape).element?.tag === "body" ||
      ((inspect as { canonicalAnchorKey?: string }).canonicalAnchorKey?.startsWith("body:") ?? false)))
  );
}

// ── Inspect object shape ──────────────────────────────────────────────────────

interface InspectElementShape {
  element?: {
    tag?: string;
    ariaLabel?: string;
    textContent?: string;
  };
  canonicalAnchorKey?: string;
}

function asInspectObject(inspect: unknown): InspectElementShape | undefined {
  return typeof inspect === "object" && inspect !== null
    ? (inspect as InspectElementShape)
    : undefined;
}

function asExcerptObject(excerpt: unknown): { text?: string } | undefined {
  return typeof excerpt === "object" && excerpt !== null
    ? (excerpt as { text?: string })
    : undefined;
}

// ── Per-field comparison helpers ──────────────────────────────────────────────

function matchTagName(
  surfaceMetadata: Record<string, string | undefined>,
  inspectObject: InspectElementShape | undefined,
): boolean {
  if (!surfaceMetadata.tagName || surfaceMetadata.tagName === "unknown") return true;
  return inspectObject?.element?.tag === surfaceMetadata.tagName;
}

function matchAriaLabel(
  surfaceMetadata: Record<string, string | undefined>,
  redactPII: boolean,
  inspectObject: InspectElementShape | undefined,
): boolean {
  if (redactPII) return true;
  if (!surfaceMetadata.ariaLabel) return true;
  return inspectObject?.element?.ariaLabel === surfaceMetadata.ariaLabel;
}

function matchTextSnippet(
  surfaceMetadata: Record<string, string | undefined>,
  redactPII: boolean,
  inspectObject: InspectElementShape | undefined,
  excerpt: unknown,
): boolean {
  if (redactPII || !surfaceMetadata.textSnippet) return true;
  const excerptObj = asExcerptObject(excerpt);
  const snippet = normalizeComparableText(surfaceMetadata.textSnippet);
  const excerptText = normalizeComparableText(excerptObj?.text);
  const inspectText = normalizeComparableText(inspectObject?.element?.textContent);
  return excerptText.includes(snippet) || inspectText.includes(snippet);
}

// ── Main matcher ───────────────────────────────────────────────────────────────

export function matchesStoredMetadata(
  surfaceMetadata: Record<string, string | undefined> | undefined,
  inspect: unknown,
  excerpt: unknown,
  redactPII: boolean,
): boolean {
  if (!surfaceMetadata) return true;
  const inspectObject = asInspectObject(inspect);
  if (!matchTagName(surfaceMetadata, inspectObject)) return false;
  if (!matchAriaLabel(surfaceMetadata, redactPII, inspectObject)) return false;
  if (!matchTextSnippet(surfaceMetadata, redactPII, inspectObject, excerpt)) return false;
  return true;
}

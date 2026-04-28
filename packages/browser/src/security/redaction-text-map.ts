import type { RedactionPolicy } from "./security-types.js";
import { redactText } from "./redaction-patterns.js";
import type { TextMapLike } from "./redaction-response-types.js";

export function redactTextMapResponse(response: TextMapLike, policy: RedactionPolicy): boolean {
  if (!response.segments || response.segments.length === 0) return false;
  let anyApplied = false;
  for (const segment of response.segments) {
    anyApplied = redactSegment(segment, policy) || anyApplied;
  }
  return anyApplied;
}

function redactSegment(segment: TextMapLike["segments"][number], policy: RedactionPolicy): boolean {
  let anyApplied = false;
  anyApplied = redactRequiredField(segment, "textRaw", policy) || anyApplied;
  anyApplied = redactRequiredField(segment, "textNormalized", policy) || anyApplied;
  if (segment.accessibleName !== undefined) {
    const r = redactText(segment.accessibleName, policy);
    segment.accessibleName = r.text;
    anyApplied = r.redactionApplied || anyApplied;
  }
  return anyApplied;
}

function redactRequiredField<T extends "textRaw" | "textNormalized">(segment: TextMapLike["segments"][number], key: T, policy: RedactionPolicy): boolean {
  if (!segment[key]) return false;
  const r = redactText(segment[key], policy);
  segment[key] = r.text;
  return r.redactionApplied;
}

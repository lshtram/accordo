import type { RedactionPolicy } from "./security-types.js";
import { redactText } from "./redaction-patterns.js";
import type { DomExcerptLike, InspectElementLike } from "./redaction-response-types.js";

const INSPECT_TEXT_KEYS = ["name", "textContent", "ariaLabel", "placeholder", "accessibleName"] as const;

export function redactInspectElementResponse(response: InspectElementLike, policy: RedactionPolicy): boolean {
  let anyApplied = false;
  if (response.element) anyApplied = redactInspectTextFields(response.element, policy) || anyApplied;
  if (response.context) anyApplied = redactInspectTextFields(response.context, policy) || anyApplied;
  return anyApplied;
}

export function redactDomExcerptResponse(response: DomExcerptLike, policy: RedactionPolicy): boolean {
  if (!response.text || response.text.length === 0) return false;
  const result = redactText(response.text, policy);
  response.text = result.text;
  return result.redactionApplied;
}

function redactInspectTextFields(obj: Record<string, unknown>, policy: RedactionPolicy): boolean {
  let anyApplied = false;
  for (const key of Object.keys(obj)) {
    if (isInspectTextKey(key) && typeof obj[key] === "string" && obj[key].length > 0) {
      const r = redactText(obj[key], policy);
      obj[key] = r.text;
      anyApplied = r.redactionApplied || anyApplied;
    }
  }
  return anyApplied;
}

function isInspectTextKey(key: string): key is typeof INSPECT_TEXT_KEYS[number] {
  return (INSPECT_TEXT_KEYS as readonly string[]).includes(key);
}

const TEXT_FIELDS = new Set([
  "text",
  "textRaw",
  "textNormalized",
  "name",
  "role",
  "ariaLabel",
  "accessibleName",
  "textContent",
  "description",
  "value",
  "label",
  "alt",
  "title",
  "placeholder",
  "action",
  "method",
]);

const IDENTIFIER_FIELDS = new Set([
  "anchorKey",
  "auditId",
  "canonicalAnchorKey",
  "frameId",
  "nodeId",
  "pageId",
  "ref",
  "snapshotId",
  "uid",
]);

const IDENTIFIER_ARRAY_FIELDS = new Set(["uids"]);

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?<!\d)(?:\+\d{7,15}|(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)[\s.-]?|\d{3}[\s.-])\d{3}[\s.-]\d{4})(?!\d)/g;
const API_KEY_RE = /(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?token|auth[_-]?token|bearer|password|passwd|pwd)["\s:=]+[a-zA-Z0-9_\-]{8,}/gi;

function redactString(value: string): { value: string; redacted: boolean } {
  let result = value;
  const before = result;
  result = result.replace(EMAIL_RE, "[REDACTED]");
  result = result.replace(PHONE_RE, "[REDACTED]");
  result = result.replace(API_KEY_RE, (match) => {
    const colon = match.indexOf(":");
    const equals = match.indexOf("=");
    const sep = colon !== -1 ? colon : equals;
    if (sep !== -1 && sep < match.length - 1) {
      return `${match.slice(0, sep + 1)}[REDACTED]`;
    }
    return "[REDACTED]";
  });
  return { value: result, redacted: result !== before };
}

function redactValue(value: unknown): { value: unknown; redacted: boolean } {
  if (typeof value === "string") {
    const { value: redacted, redacted: didRedact } = redactString(value);
    return { value: redacted, redacted: didRedact };
  }

  if (Array.isArray(value)) {
    let anyRedacted = false;
    const result = value.map((item) => {
      const { value: r, redacted } = redactValue(item);
      if (redacted) anyRedacted = true;
      return r;
    });
    return { value: result, redacted: anyRedacted };
  }

  if (value !== null && typeof value === "object") {
    let anyRedacted = false;
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, fieldVal] of Object.entries(obj)) {
      if (IDENTIFIER_FIELDS.has(key) || IDENTIFIER_ARRAY_FIELDS.has(key)) {
        result[key] = fieldVal;
      } else if (TEXT_FIELDS.has(key) && typeof fieldVal === "string") {
        const { value: redacted, redacted: didRedact } = redactString(fieldVal);
        result[key] = redacted;
        if (didRedact) anyRedacted = true;
      } else {
        const { value: r, redacted } = redactValue(fieldVal);
        result[key] = r;
        if (redacted) anyRedacted = true;
      }
    }

    return { value: result, redacted: anyRedacted };
  }

  return { value, redacted: false };
}

export function applyRedaction(
  data: unknown,
): { data: unknown; redactionApplied: boolean } {
  try {
    const { value, redacted } = redactValue(data);
    return { data: value, redactionApplied: redacted };
  } catch {
    throw new Error("redaction-processing-error");
  }
}

export function attachRedactionWarning(
  response: Record<string, unknown>,
  redactPII: boolean | undefined,
): void {
  if (!redactPII) {
    response.redactionWarning = "PII may be present in response";
  }
}

export function buildRedactionFailedResponse(
  requestId: string,
  auditId: string,
): {
  requestId: string;
  success: false;
  error: "redaction-failed";
  retryable: false;
  auditId: string;
} {
  return { requestId, success: false, error: "redaction-failed", retryable: false, auditId };
}

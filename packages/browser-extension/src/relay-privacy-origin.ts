import { resolveRequestedUrl, resolveTargetTabId } from "./relay-forwarder.js";

function readOptionalStringArray(
  payload: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const val = payload[field];
  if (!Array.isArray(val)) return undefined;
  if (val.every((item) => typeof item === "string")) {
    return val as string[];
  }
  return undefined;
}

export function parseOriginPolicy(
  payload: Record<string, unknown>,
): {
  allowedOrigins: string[] | undefined;
  deniedOrigins: string[] | undefined;
} {
  const allowedOrigins = readOptionalStringArray(payload, "allowedOrigins");
  const deniedOrigins = readOptionalStringArray(payload, "deniedOrigins");
  return { allowedOrigins, deniedOrigins };
}

export function isOriginBlockedByPolicy(
  origin: string,
  allowedOrigins: string[] | undefined,
  deniedOrigins: string[] | undefined,
): boolean {
  const normalize = (o: string): string => o.endsWith("/") ? o.slice(0, -1) : o;

  if (deniedOrigins !== undefined && deniedOrigins.length > 0) {
    const denied = deniedOrigins.map(normalize);
    const normalizedOrigin = normalize(origin);
    if (denied.includes(normalizedOrigin)) return true;
  }

  if (allowedOrigins !== undefined && allowedOrigins.length > 0) {
    const allowed = allowedOrigins.map(normalize);
    const normalizedOrigin = normalize(origin);
    if (!allowed.includes(normalizedOrigin)) return true;
  }

  return false;
}

export async function checkOriginBlocked(
  request: { requestId: string; payload: Record<string, unknown> },
): Promise<{ blocked: true; response: { requestId: string; success: false; error: "origin-blocked"; retryable: false } } | { blocked: false; origin: string; pageId: string }> {
  const { allowedOrigins, deniedOrigins } = parseOriginPolicy(request.payload);

  if (allowedOrigins === undefined && deniedOrigins === undefined) {
    const origin = typeof document !== "undefined" ? window.location.origin : "unknown";
    return { blocked: false, origin, pageId: "" };
  }

  const tabId = await resolveTargetTabId(request.payload);
  let origin = "unknown";
  let pageId = "";

  if (typeof document !== "undefined") {
    origin = window.location.origin;
  } else if (tabId !== undefined) {
    const url = await resolveRequestedUrl(request.payload);
    if (url) {
      try {
        origin = new URL(url).origin;
        pageId = `tab-${tabId}`;
      } catch {
        origin = "unknown";
      }
    }
  }

  if (isOriginBlockedByPolicy(origin, allowedOrigins, deniedOrigins)) {
    return {
      blocked: true,
      response: {
        requestId: request.requestId,
        success: false,
        error: "origin-blocked",
        retryable: false,
      },
    };
  }

  return { blocked: false, origin, pageId };
}

export function buildBlockedResponse(requestId: string, auditId: string): {
  requestId: string;
  success: false;
  error: "origin-blocked";
  retryable: false;
  auditId: string;
} {
  return { requestId, success: false, error: "origin-blocked", retryable: false, auditId };
}

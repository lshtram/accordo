import type { RelayActionResponse } from "./relay-definitions.js";

const RELAY_ERROR_CODES = new Set<string>([
  "action-failed",
  "unsupported-action",
  "invalid-request",
  "no-target",
  "capture-failed",
  "image-too-large",
  "snapshot-not-found",
  "snapshot-stale",
  "navigation-interrupted",
  "page-closed",
  "control-not-granted",
  "tab-not-found",
  "unsupported-page",
  "element-not-found",
  "element-not-focusable",
  "element-off-screen",
  "iframe-cross-origin",
  "no-content-script",
  "origin-blocked",
  "redaction-failed",
]);

export function readForwardedContentError(data: unknown): RelayActionResponse["error"] | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const error = (data as { error?: unknown }).error;
  return isRelayErrorCode(error) ? error : undefined;
}

function isRelayErrorCode(value: unknown): value is NonNullable<RelayActionResponse["error"]> {
  return typeof value === "string" && RELAY_ERROR_CODES.has(value);
}

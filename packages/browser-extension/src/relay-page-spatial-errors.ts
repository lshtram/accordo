import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";
import { getErrorMeta } from "./relay-definitions.js";

type RelayErrorCode = NonNullable<RelayActionResponse["error"]>;

const PRESERVED_SPATIAL_ERRORS = new Set<RelayErrorCode>([
  "invalid-request",
  "snapshot-not-found",
  "snapshot-stale",
]);

export function readSpatialError(
  action: string,
  response: unknown,
): RelayErrorCode | undefined {
  if (action !== "get_spatial_relations") return undefined;
  const code = typeof response === "object" && response !== null
    ? (response as { error?: unknown }).error
    : undefined;
  return typeof code === "string" && PRESERVED_SPATIAL_ERRORS.has(code as RelayErrorCode)
    ? (code as RelayErrorCode)
    : undefined;
}

export function buildSpatialErrorResponse(
  request: RelayActionRequest,
  code: RelayErrorCode,
): RelayActionResponse {
  return {
    requestId: request.requestId,
    success: false,
    error: code,
    ...getErrorMeta(code),
  };
}

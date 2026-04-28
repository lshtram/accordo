/**
 * relay-get-page-map.ts — Page-map relay action dispatcher.
 *
 * Local path via relay-get-page-map-local.ts; remote path via relay-get-page-map-remote.ts.
 *
 * @module
 */

import type { RelayActionRequest, RelayActionResponse } from "./relay-definitions.js";

export async function handleGetPageMap(request: RelayActionRequest): Promise<RelayActionResponse> {
  if (typeof document !== "undefined") {
    const { handleGetPageMapLocal } = await import("./relay-get-page-map-local.js");
    return handleGetPageMapLocal(request);
  }
  const { handleGetPageMapRemote } = await import("./relay-get-page-map-remote.js");
  return handleGetPageMapRemote(request);
}
/**
 * Hub health read seam — thin re-export layer.
 *
 * Responsibilities:
 * - readHubHealth(port): port-explicit /health reader used by rebind probing
 * - checkHubHealth(port): boolean liveness check for callers that only need alive/not-alive
 *
 * The heavy HTTP logic lives in hub-health-http.ts; this module wires it
 * to the node:http module for production use.
 */

import type { HealthResponse } from "@accordo/bridge-types";
import { readHubHealthWithDeps, HEALTH_TIMEOUT_MS } from "./hub-health-http.js";
import type { HubHealthHttpDeps } from "./hub-health-http.js";
import http from "node:http";

export { HEALTH_TIMEOUT_MS };
export { readHubHealthWithDeps };
export type { HubHealthHttpDeps };

/**
 * Port-explicit `/health` reader used by both liveness checks and Priority T
 * registry rebind probing.
 */
export async function readHubHealth(port: number): Promise<HealthResponse | null> {
  return readHubHealthWithDeps(port, { get: (opts, cb) => http.get(opts as http.RequestOptions, cb as (res: http.IncomingMessage) => void), testFixture: undefined });
}

/**
 * Backward-compatible boolean probe for callers that only need liveness.
 * Returns true when Hub responds 2xx with valid JSON.
 */
export async function checkHubHealth(port: number): Promise<boolean> {
  const result = await readHubHealth(port);
  return result !== null;
}
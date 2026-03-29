/**
 * Hub Server — Reauth Handler
 *
 * Handles POST /bridge/reauth — credential rotation flow. The Bridge
 * sends new token + secret values; this handler atomically updates
 * them in the Hub's in-memory state and persists the token to disk.
 *
 * Pattern: factory function `createReauthHandler(deps)` returns the
 * `handleReauth` function wired into the router.
 *
 * Requirements: requirements-hub.md §2.6
 */

import type http from "node:http";

// ─── Dependency Interface ──────────────────────────────────────────────────

/**
 * Dependencies injected into the reauth handler factory.
 */
export interface ReauthDeps {
  /**
   * Update the bearer token in memory and persist to disk.
   * Called with the new token value from the reauth request body.
   */
  updateToken: (newToken: string) => void;

  /**
   * Update the bridge secret in the BridgeServer's in-memory state.
   * Called with the new secret value from the reauth request body.
   */
  updateBridgeSecret: (newSecret: string) => void;

  /**
   * Update the bridge secret stored in HubServerOptions (for future
   * validateBridgeSecret calls on subsequent requests).
   */
  updateOptionsBridgeSecret: (newSecret: string) => void;
}

// ─── Return Type ────────────────────────────────────────────────────────────

/**
 * The reauth handler object returned by `createReauthHandler()`.
 */
export interface ReauthHandler {
  /**
   * Handle POST /bridge/reauth — credential rotation.
   *
   * Steps:
   * 1. Validate Content-Type is application/json
   * 2. Read and parse JSON body
   * 3. Validate presence of newToken and newSecret fields
   * 4. Update token (in memory + disk via updateToken)
   * 5. Update bridge secret (in BridgeServer + options)
   * 6. Return 200 {}
   *
   * Error responses:
   * - 400 if Content-Type is not application/json
   * - 400 if body is not valid JSON
   * - 400 if newToken or newSecret is missing
   *
   * @param req - Incoming HTTP request (body not yet consumed)
   * @param res - HTTP response object
   */
  handleReauth: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create the reauth request handler.
 *
 * @param deps - Injected dependencies
 * @returns ReauthHandler with handleReauth function
 */
export function createReauthHandler(deps: ReauthDeps): ReauthHandler {
  function handleReauth(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Require application/json body
    const ct = req.headers["content-type"] ?? "";
    if (!ct.includes("application/json")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad Request: expected application/json body" }));
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      let newToken: string | undefined;
      let newSecret: string | undefined;
      try {
        const raw = JSON.parse(body) as Record<string, unknown>;
        const t = raw["newToken"];
        const s = raw["newSecret"];
        if (typeof t === "string") newToken = t;
        if (typeof s === "string") newSecret = s;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      if (!newToken || !newSecret) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing newToken or newSecret" }));
        return;
      }

      deps.updateToken(newToken);
      deps.updateBridgeSecret(newSecret);
      deps.updateOptionsBridgeSecret(newSecret);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  }

  return { handleReauth };
}

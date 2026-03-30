/**
 * Hub Health — HTTP health-check and reauth flow
 *
 * Pure HTTP responsibilities:
 * - GET /health → checkHealth() (LCM-02)
 * - GET /health polling until ready or timeout (LCM-07)
 * - POST /bridge/reauth → attemptReauth() (LCM-12)
 *
 * Does NOT manage process state — only HTTP interactions.
 *
 * Requirements: requirements-bridge.md §4 (LCM-02, LCM-07, LCM-12)
 */

import http from "node:http";

/**
 * Events emitted by the health layer for HubManager to handle.
 */
export interface HubHealthEvents {
  /** Fired when pollHealth succeeds. */
  onHealthy(): void;
  /** Fired when pollHealth times out. */
  onTimeout(): void;
}

/**
 * Shared mutable port state.
 * HubManager holds the mutable `port` and shares a reference to HubHealth
 * so that _applyPortFile in the original code can be handled here.
 */
export interface HubHealthSharedState {
  port: number;
}

/**
 * Create a HubHealth instance for HTTP health checks and reauth.
 *
 * @param outputChannel - Output channel for logging
 * @param state        - Shared mutable port (updated on each poll via _applyPortFile)
 */
export class HubHealth {
  constructor(
    private readonly outputChannel: { appendLine(value: string): void },
    private readonly state: HubHealthSharedState,
  ) {}

  /**
   * LCM-02: Check if Hub is alive via GET /health.
   *
   * @returns true if Hub responds to health check within 2s
   */
  async checkHealth(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.get(
        { host: "127.0.0.1", port: this.state.port, path: "/health", timeout: 2000 },
        (res) => {
          resolve(res.statusCode === 200);
          res.resume();
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * LCM-07: Poll /health until Hub responds or timeout.
   *
   * @param maxWaitMs  - Maximum wait time (default: 10000)
   * @param intervalMs - Poll interval (default: 500)
   * @returns true if Hub became healthy, false on timeout
   */
  async pollHealth(maxWaitMs = 10000, intervalMs = 500): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    return new Promise((resolve) => {
      const attempt = (): void => {
        if (Date.now() >= deadline) {
          resolve(false);
          return;
        }
        this.checkHealth()
          .then((healthy) => {
            if (healthy) {
              resolve(true);
            } else if (Date.now() < deadline) {
              setTimeout(attempt, intervalMs);
            } else {
              resolve(false);
            }
          })
          .catch(() => {
            if (Date.now() < deadline) {
              setTimeout(attempt, intervalMs);
            } else {
              resolve(false);
            }
          });
      };
      setTimeout(attempt, intervalMs);
    });
  }

  /**
   * LCM-12: Attempt soft credential rotation via POST /bridge/reauth.
   *
   * @param currentSecret - Current bridge secret for auth
   * @param newSecret     - New bridge secret
   * @param newToken      - New bearer token
   * @returns true if reauth succeeded (200 response)
   */
  async attemptReauth(
    currentSecret: string,
    newSecret: string,
    newToken: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const body = JSON.stringify({ newToken, newSecret });
      const options: http.RequestOptions = {
        host: "127.0.0.1",
        port: this.state.port,
        path: "/bridge/reauth",
        method: "POST",
        headers: {
          "x-accordo-secret": currentSecret,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      };
      const req = http.request(options, (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      });
      req.on("error", () => resolve(false));
      req.write(body);
      req.end();
    });
  }
}

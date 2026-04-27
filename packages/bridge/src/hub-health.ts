/**
 * Hub Health facade — small stateful wrapper around focused HTTP helpers.
 *
 * Responsibilities:
 * - Use current manager port for standard liveness checks
 * - Expose explicit port-based `/health` reads for Priority T rebind probing
 * - Forward reauth and graceful disconnect requests
 */

import http from "node:http";
import { DISCONNECT_REQUEST_TIMEOUT_MS } from "@accordo/bridge-types";
import type { HealthResponse } from "@accordo/bridge-types";
import { checkHubHealth, readHubHealth } from "./hub-health-read.js";
import type { HubHealthEvents, HubHealthSharedState } from "./hub-health-types.js";

export type { HubHealthEvents, HubHealthSharedState } from "./hub-health-types.js";

export class HubHealth {
  constructor(
    private readonly outputChannel: { appendLine(value: string): void },
    private readonly state: HubHealthSharedState,
  ) {}

  async checkHealth(): Promise<boolean> {
    return checkHubHealth(this.state.port);
  }

  /** Priority T seam: explicit port-probing contract for registry rebind checks. */
  async readHealth(port: number): Promise<HealthResponse | null> {
    return readHubHealth(port);
  }

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

  async attemptReauth(currentSecret: string, newSecret: string, newToken: string): Promise<boolean> {
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

  async sendDisconnect(bridgeSecret: string): Promise<boolean> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<false>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), DISCONNECT_REQUEST_TIMEOUT_MS);
    });
    try {
      const fetchPromise: Promise<boolean> = fetch(`http://127.0.0.1:${this.state.port}/bridge/disconnect`, {
        method: "POST",
        headers: {
          "x-accordo-secret": bridgeSecret,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(DISCONNECT_REQUEST_TIMEOUT_MS),
      }).then((resp) => resp.status === 200).catch((): boolean => false);
      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch {
      this.outputChannel.appendLine("[accordo-bridge] sendDisconnect failed");
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

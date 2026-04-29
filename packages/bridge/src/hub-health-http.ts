/**
 * Low-level HTTP health-read implementation.
 *
 * Behaviour per LCM-13:
 * - Makes HTTP GET to http://localhost:<port>/health
 * - Returns null on non-2xx, connection error, timeout, or invalid JSON
 * - Returns parsed HealthResponse on 2xx + valid JSON
 *
 * Guards all .on/.end/.destroy calls for test-double compatibility.
 * Single-settle guard prevents duplicate resolve() calls.
 *
 * Test-double seam: when `testFixture` is provided, the function returns it
 * immediately without making any HTTP calls.
 */
import type * as http from "node:http";
import type { HealthResponse } from "@accordo/bridge-types";
import { parseHealthBody } from "./hub-health-parse.js";

export const HEALTH_TIMEOUT_MS = 2_000;

export interface HubHealthHttpDeps {
  get(
    options: http.RequestOptions,
    listener: (res: http.IncomingMessage) => void,
  ): http.ClientRequest;
}

export interface ReadHubHealthDeps extends HubHealthHttpDeps {
  /** Test-only escape hatch: bypasses HTTP I/O and returns the fixture directly. */
  testFixture?: HealthResponse | null;
}

/** Wraps raw chunks + ended flag for handleResponse closure. */
function makeChunkCollector(): { chunks: Buffer[]; setEnded: () => void; isEnded: () => boolean } {
  const chunks: Buffer[] = [];
  let ended = false;
  return {
    chunks,
    setEnded: (): void => { ended = true; },
    isEnded: (): boolean => ended,
  };
}

/** Handle a successful HTTP response — validates status, collects body, parses.
 *  timeoutId is captured from the enclosing Promise scope via closure. */
function makeResponseHandler(
  res: http.IncomingMessage,
  settle: (val: HealthResponse | null) => void,
  collector: { chunks: Buffer[]; setEnded: () => void },
  clearT: (id: ReturnType<typeof setTimeout>) => void,
  timeoutId: ReturnType<typeof setTimeout>,
): void {
  if (res.statusCode === undefined || res.statusCode < 200 || res.statusCode >= 300) {
    clearT(timeoutId);
    settle(null);
    return;
  }
  res.on("data", (chunk: Buffer) => { collector.chunks.push(chunk); });
  res.on("end", () => {
    collector.setEnded();
    clearT(timeoutId);
    const raw = Buffer.concat(collector.chunks).toString("utf8");
    const parsed = parseHealthBody(raw);
    settle(parsed);
  });
}

export async function readHubHealthWithDeps(
  port: number,
  httpDeps: ReadHubHealthDeps,
): Promise<HealthResponse | null> {
  if (httpDeps.testFixture !== undefined) {
    return httpDeps.testFixture;
  }
  return new Promise<HealthResponse | null>((resolve) => {
    let settled = false;
    const settle = (val: HealthResponse | null): void => {
      if (!settled) { settled = true; resolve(val); }
    };

    const timeoutId = setTimeout(() => settle(null), HEALTH_TIMEOUT_MS);
    const collector = makeChunkCollector();
    let responseHandled = false;

    const handleResponseOnce = (res: http.IncomingMessage): void => {
      if (responseHandled) return;
      responseHandled = true;
      clearTimeout(timeoutId);
      makeResponseHandler(res, settle, collector, clearTimeout, timeoutId);
    };

    const req = httpDeps.get(
      { hostname: "127.0.0.1", port, path: "/health", method: "GET", timeout: HEALTH_TIMEOUT_MS },
      (res): void => {
        handleResponseOnce(res);
      },
    );

    const reqPartial = req as Partial<http.ClientRequest>;

    const safeOn = (event: string, handler: (...args: unknown[]) => void): void => {
      if (typeof reqPartial.on === "function") reqPartial.on(event, handler);
    };
    safeOn("response", (res) => {
      handleResponseOnce(res as http.IncomingMessage);
    });
    safeOn("error", () => { clearTimeout(timeoutId); settle(null); });
    safeOn("timeout", () => {
      clearTimeout(timeoutId);
      if (typeof reqPartial.destroy === "function") reqPartial.destroy();
      settle(null);
    });

    if (typeof reqPartial.end === "function") reqPartial.end();
  });
}

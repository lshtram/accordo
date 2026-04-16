/**
 * browser-extension-modularity.test.ts
 *
 * Phase B failing tests for browser-extension-side extracted modules from the
 * browser family modularity batch.
 *
 * Tests the extracted module contracts from:
 *   docs/reviews/browser-family-modularity-A.md
 *   docs/10-architecture/architecture.md §14-B
 *
 * Each test is labeled with its Phase A requirement ID.
 * All behavioral tests fail at assertion level because the module stubs throw "not implemented".
 * Structural/shape tests pass on stubs (interface/type verification).
 *
 * Covered modules (packages/browser-extension):
 *   relay-config.ts, relay-transport.ts
 *
 * API checklist (coverage):
 *   RelayConfig                   [relay-config] — interface test
 *   DEFAULT_RELAY_CONFIG          [relay-config] — 1 test
 *   getRelayConfig                [relay-config] — 1 test (behavioral)
 *   TransportState                 [relay-transport] — type test
 *   RelayTransportEvents           [relay-transport] — interface test
 *   RelayTransport.getState        [relay-transport] — 1 test
 *   RelayTransport.start           [relay-transport] — 3 tests (idempotent, connects, throws when stopped)
 *   RelayTransport.stop            [relay-transport] — 2 tests (cleans up, idempotent)
 *   RelayTransport.send            [relay-transport] — 2 tests (returns false when stopped, sends when connected)
 *   RelayTransport.isConnected     [relay-transport] — 1 test
 *   Architecture constraints        — 2 tests (no cross-modality imports)
 *
 * Total: ~21 tests across 2 modules + architecture constraints.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetChromeMocks } from "./setup/chrome-mock.js";
import * as fs from "node:fs";
import * as path from "node:path";
import type { RelayConfig } from "../src/relay-config.js";
import type { TransportState, RelayTransportEvents } from "../src/relay-transport.js";

// ─────────────────────────────────────────────────────────────────────────────
// Architecture constraint helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Absolute path to the browser-extension src directory */
const EXT_SRC = path.resolve(__dirname, "../src");

/** Files that are allowed to import from bridge-types directly */
const BRIDGE_TYPES_ALLOWLIST = new Set([
  "relay-config.ts",
  "relay-transport.ts",
]);

/**
 * Scan a source file for imports that cross modality boundaries.
 * Returns an array of violating import paths.
 */
function findCrossModalityImports(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const violations: string[] = [];
  // Match any import from "../../browser/..." or "../../../browser/..."
  // or direct imports of vscode, @accordo/editor, @accordo/hub
  const crossModalityPattern =
    /import\s+.*?from\s+['"](?:\.\.\/)+(?:browser|accordo-editor|accordo-hub)(?:\/[^'"]*)?['"]/;
  const vscodePattern = /import\s+.*?from\s+['"](?:vscode|@types\/vscode)['"]/;
  for (const line of content.split("\n")) {
    if (crossModalityPattern.test(line) || vscodePattern.test(line)) {
      violations.push(line.trim());
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE: relay-config.ts
// Source: docs/reviews/browser-family-modularity-A.md §"packages/browser-extension/src/relay-config.ts"
// ─────────────────────────────────────────────────────────────────────────────

describe("relay-config (browser-extension)", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  describe("RelayConfig interface", () => {
    it("MV3-RELay-CFG-01: RelayConfig is exported with host, port, reconnectDelayMs, heartbeatIntervalMs, tokenPollIntervalMs", async () => {
      await import("../src/relay-config.js");
      const config: RelayConfig = {
        host: "127.0.0.1",
        port: 40111,
        reconnectDelayMs: 2000,
        heartbeatIntervalMs: 15000,
        tokenPollIntervalMs: 60_000,
      };
      expect(config.host).toBe("127.0.0.1");
      expect(config.port).toBe(40111);
      expect(config.reconnectDelayMs).toBe(2000);
      expect(config.heartbeatIntervalMs).toBe(15000);
      expect(config.tokenPollIntervalMs).toBe(60_000);
    });
  });

  describe("DEFAULT_RELAY_CONFIG", () => {
    it("MV3-RELay-CFG-02: DEFAULT_RELAY_CONFIG has correct hardcoded values", async () => {
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      expect(DEFAULT_RELAY_CONFIG.host).toBe("127.0.0.1");
      expect(DEFAULT_RELAY_CONFIG.port).toBe(40111);
      expect(DEFAULT_RELAY_CONFIG.reconnectDelayMs).toBe(2000);
      expect(DEFAULT_RELAY_CONFIG.heartbeatIntervalMs).toBe(15000);
      expect(DEFAULT_RELAY_CONFIG.tokenPollIntervalMs).toBe(60_000);
    });
  });

  describe("getRelayConfig", () => {
    it("MV3-RELay-CFG-03: getRelayConfig() reads from chrome.storage.local and resolves to RelayConfig (never throws)", async () => {
      const { getRelayConfig } = await import("../src/relay-config.js");
      // Phase A specifies: reads from chrome.storage.local, falls back to DEFAULT_RELAY_CONFIG
      // Stub throws — test verifies the resolved value contract, not the throw
      await expect(getRelayConfig()).resolves.toBeDefined();
    });

    it("MV3-RELay-CFG-04: getRelayConfig() falls back to DEFAULT_RELAY_CONFIG when storage is empty", async () => {
      const { getRelayConfig, DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      // chrome.storage.local.get is mocked to return {} by default in chrome-mock
      const result = await getRelayConfig();
      // When storage is empty, implementation must use DEFAULT_RELAY_CONFIG values
      expect(result.host).toBe(DEFAULT_RELAY_CONFIG.host);
      expect(result.port).toBe(DEFAULT_RELAY_CONFIG.port);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MODULE: relay-transport.ts
// Source: docs/reviews/browser-family-modularity-A.md §"packages/browser-extension/src/relay-transport.ts"
// ─────────────────────────────────────────────────────────────────────────────

describe("relay-transport (browser-extension)", () => {
  beforeEach(() => {
    resetChromeMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TransportState type", () => {
    it("MV3-LIFECYCLE-01: TransportState is the four-state union", async () => {
      await import("../src/relay-transport.js");
      // Assign each state to prove the union accepts all four
      const states: TransportState[] = [
        "disconnected",
        "connecting",
        "connected",
        "reconnecting",
      ];
      for (const s of states) {
        const check: TransportState = s;
        expect(check).toBe(s);
      }
    });
  });

  describe("RelayTransportEvents interface", () => {
    it("MV3-EVENTS-01: RelayTransportEvents has optional onStateChange, onMessage, onError", async () => {
      await import("../src/relay-transport.js");
      const events: RelayTransportEvents = {
        onStateChange: (state: TransportState) => {
          void state;
        },
        onMessage: (data: string) => {
          void data;
        },
        onError: (err: string) => {
          void err;
        },
      };
      expect(typeof events.onStateChange).toBe("function");
      expect(typeof events.onMessage).toBe("function");
      expect(typeof events.onError).toBe("function");
    });
  });

  describe("RelayTransport class — initial state", () => {
    it("MV3-LIFECYCLE-02: new instance starts in disconnected state", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});
      expect(transport.getState()).toBe("disconnected");
    });

    it("MV3-LIFECYCLE-02b: isConnected() returns false in initial disconnected state", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe("RelayTransport.start() — MV3 lifecycle semantics", () => {
    it("MV3-LIFECYCLE-03: start() is idempotent — calling start() twice does not throw", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});

      // Phase A contract: start() is idempotent; second call must not throw
      // Stub throws → test fails until implemented
      expect(() => transport.start()).not.toThrow();
      expect(() => transport.start()).not.toThrow(); // idempotent — must not throw either
    });

    it("MV3-LIFECYCLE-03b: start() transitions state from disconnected → connecting → connected", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});

      // Stub throws → test fails until implemented
      transport.start();

      // After start(), the transport must progress through states
      // Initial: disconnected, after start(): connecting or connected
      const state = transport.getState();
      expect(state).not.toBe("disconnected");
      expect(["connecting", "connected"]).toContain(state);
    });

    it("MV3-LIFECYCLE-03c: start() on an already-connected instance is a no-op (idempotent)", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});

      // First start
      transport.start();
      const stateAfterFirst = transport.getState();

      // Second start — must not throw and must not change state
      expect(() => transport.start()).not.toThrow();
      expect(transport.getState()).toBe(stateAfterFirst);
    });

    it("MV3-LIFECYCLE-03d: start() throws if stop() has been called (stopped flag)", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});

      transport.start();
      transport.stop();

      // After stop(), calling start() again must throw — no restart after stop
      // Stub throws → test fails until implemented
      expect(() => transport.start()).toThrow();
    });
  });

  describe("RelayTransport.stop() — MV3 lifecycle semantics", () => {
    it("MV3-LIFECYCLE-04: stop() completes without throwing after start()", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});

      // Start must succeed before stop can be tested
      // Stub throws → stop() is never reached
      transport.start();
      expect(() => transport.stop()).not.toThrow();
    });

    it("MV3-LIFECYCLE-04b: stop() transitions state back to disconnected", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});

      transport.start();
      transport.stop();

      expect(transport.getState()).toBe("disconnected");
      expect(transport.isConnected()).toBe(false);
    });

    it("MV3-LIFECYCLE-04c: stop() is idempotent — calling stop() twice does not throw", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});

      transport.start();
      expect(() => transport.stop()).not.toThrow();
      expect(() => transport.stop()).not.toThrow(); // idempotent — must not throw
    });

    it("MV3-LIFECYCLE-04d: stop() sets the stopped flag — start() throws after stop", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");

      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});
      transport.start();
      transport.stop();

      // After stop(), start() must throw because stopped flag is set.
      // This is the MV3 contract: stop() is final, no restart allowed.
      expect(() => transport.start()).toThrow();
    });
  });

  describe("RelayTransport.send() — MV3 lifecycle semantics", () => {
    it("MV3-LIFECYCLE-05: send() returns false when called in disconnected state", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});

      // Not started — must return false, not throw
      const result = transport.send("test");
      expect(result).toBe(false);
    });

    it("MV3-LIFECYCLE-05b: send() returns true when connected (after start, before stop)", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});

      transport.start();
      // Stub throws → test fails until implemented
      const result = transport.send("test message");
      expect(result).toBe(true);
    });

    it("MV3-LIFECYCLE-05c: send() after stop() returns false (transport closed)", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");
      const transport = new RelayTransport(DEFAULT_RELAY_CONFIG, {});

      transport.start();
      transport.stop();
      const result = transport.send("after stop");
      expect(result).toBe(false);
    });
  });

  describe("RelayTransport — polling and heartbeat semantics (§14-B)", () => {
    it("MV3-LIFECYCLE-06: RelayTransport accepts config with custom heartbeatIntervalMs and tokenPollIntervalMs", async () => {
      const { RelayTransport } = await import("../src/relay-transport.js");
      const { DEFAULT_RELAY_CONFIG } = await import("../src/relay-config.js");

      const customConfig: RelayConfig = {
        ...DEFAULT_RELAY_CONFIG,
        heartbeatIntervalMs: 30_000,
        tokenPollIntervalMs: 120_000,
      };

      const transport = new RelayTransport(customConfig, {});

      // Config is stored — the real impl would use these for timer intervals.
      // start() transitions state, proving the config was accepted.
      // Stub throws on start → this test fails at assertion level until implemented.
      transport.start();
      expect(transport.getState()).not.toBe("disconnected");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Architecture Constraints (§14-B architecture, browser↔browser-extension boundary)
// ─────────────────────────────────────────────────────────────────────────────

describe("Architecture Constraints — browser-extension modules", () => {
  const MODULE_FILES = ["relay-config.ts", "relay-transport.ts"];

  for (const filename of MODULE_FILES) {
    const filePath = path.join(EXT_SRC, filename);
    if (!fs.existsSync(filePath)) continue; // skip if stub not yet created

    describe(filename, () => {
      it(`EXT-ARCH-01 (${filename}): does not import from packages/browser source`, () => {
        const violations = findCrossModalityImports(filePath);
        expect(violations, `Found cross-modality imports in ${filename}: ${violations.join("; ")}`).toHaveLength(0);
      });

      it(`EXT-ARCH-02 (${filename}): does not import from vscode or @accordo/editor`, () => {
        const content = fs.readFileSync(filePath, "utf-8");
        const vscodeImport =
          /import\s+.*?from\s+['"](?:vscode|@types\/vscode)['"]/;
        const editorImport =
          /import\s+.*?from\s+['"](?:\.\.\/)+(?:accordo-editor)(?:\/[^'"]*)?['"]/;
        const violations: string[] = [];
        for (const line of content.split("\n")) {
          if (vscodeImport.test(line) || editorImport.test(line)) {
            violations.push(line.trim());
          }
        }
        expect(violations, `Found disallowed imports in ${filename}: ${violations.join("; ")}`).toHaveLength(0);
      });

      it(`EXT-ARCH-03 (${filename}): does not import from @accordo/hub`, () => {
        const content = fs.readFileSync(filePath, "utf-8");
        const hubImport =
          /import\s+.*?from\s+['"](?:\.\.\/)+(?:accordo-hub)(?:\/[^'"]*)?['"]/;
        const violations: string[] = [];
        for (const line of content.split("\n")) {
          if (hubImport.test(line)) {
            violations.push(line.trim());
          }
        }
        expect(violations, `Found hub imports in ${filename}: ${violations.join("; ")}`).toHaveLength(0);
      });
    });
  }

  it("EXT-ARCH-04: browser-extension package.json does not declare a dependency on packages/browser", () => {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    if (!fs.existsSync(pkgPath)) return;
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    // No package in browser-extension should import from ../browser
    // This is enforced at the source level by EXT-ARCH-01 above
    expect(Object.keys(deps)).not.toContain("@accordo/browser");
  });
});

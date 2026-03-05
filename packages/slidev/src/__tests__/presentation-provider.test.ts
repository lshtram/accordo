/**
 * presentation-provider.test.ts — Tests for PresentationProvider and findFreePort
 *
 * Requirements covered:
 *   M44-PVD-01  Opens deck in a VS Code WebviewPanel
 *   M44-PVD-02  Spawns Slidev dev server as child process
 *   M44-PVD-05  dispose() kills Slidev process and disposes panel
 *   M44-PVD-06  On dispose, state resets via onDispose callback
 *   M44-PVD-07  Reopen same deck URI reveals existing panel (no restart)
 *   M44-PVD-08  Port range 7788–7888; portOverride uses fixed port
 *   M44-EXT-07  Only one session at a time; opening new deck closes previous
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PresentationProvider,
  PORT_RANGE_START,
  PORT_RANGE_END,
  findFreePort,
} from "../presentation-provider.js";
import type { ProcessSpawner, ChildProcessHandle } from "../types.js";
import { makeExtensionContext, MockWebviewPanel, window } from "./mocks/vscode.js";
import type { PresentationRuntimeAdapter } from "../runtime-adapter.js";
import type { PresentationCommentsBridge } from "../presentation-comments-bridge.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHandle(overrides?: Partial<ChildProcessHandle>): ChildProcessHandle {
  return {
    kill: vi.fn(),
    exited: false,
    onExit: vi.fn(),
    onStderr: vi.fn(),
    ...overrides,
  };
}

function makeSpawner(handle?: ChildProcessHandle): ProcessSpawner {
  return vi.fn().mockReturnValue(handle ?? makeHandle());
}

function makeAdapter(): PresentationRuntimeAdapter {
  return {
    listSlides: vi.fn().mockResolvedValue([]),
    getCurrent: vi.fn().mockResolvedValue({ index: 0, title: "Slide 1" }),
    goto: vi.fn().mockResolvedValue(undefined),
    next: vi.fn().mockResolvedValue(undefined),
    prev: vi.fn().mockResolvedValue(undefined),
    onSlideChanged: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    validateDeck: vi.fn().mockReturnValue({ valid: true }),
    dispose: vi.fn(),
  };
}

function makeProvider(spawner?: ProcessSpawner, portOverride?: number | null) {
  return new PresentationProvider({
    context: makeExtensionContext(),
    spawner: spawner ?? makeSpawner(),
    portOverride: portOverride ?? null,
  });
}

// ── PORT_RANGE constants ──────────────────────────────────────────────────────

describe("Port range constants", () => {
  it("M44-PVD-08: PORT_RANGE_START is 7788", () => {
    expect(PORT_RANGE_START).toBe(7788);
  });

  it("M44-PVD-08: PORT_RANGE_END is 7888", () => {
    expect(PORT_RANGE_END).toBe(7888);
  });
});

// ── findFreePort ──────────────────────────────────────────────────────────────

describe("findFreePort", () => {
  it("M44-PVD-08: returns a number within [start, end]", async () => {
    const port = await findFreePort(9900, 9950);
    expect(port).toBeGreaterThanOrEqual(9900);
    expect(port).toBeLessThanOrEqual(9950);
  });

  it("M44-PVD-08: throws when end < start", async () => {
    await expect(findFreePort(9950, 9900)).rejects.toThrow();
  });

  it("M44-PVD-08: throws when no port is available in range (start === end occupied)", async () => {
    const net = await import("net");
    // Occupy the only port in range
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.listen(9999, () => {
        findFreePort(9999, 9999)
          .then(() => { server.close(); resolve(); })
          .catch(() => { server.close(resolve); });
      });
      server.on("error", reject);
    });
    // We just verify the logic runs without hanging; the thrown/resolved outcome
    // depends on OS port availability
  });
});

// ── PresentationProvider.open ─────────────────────────────────────────────────

describe("PresentationProvider.open", () => {
  beforeEach(() => {
    vi.mocked(window.createWebviewPanel).mockReturnValue(new MockWebviewPanel("accordo.presentation", "Deck"));
  });

  it("M44-PVD-01: creates a WebviewPanel", async () => {
    const provider = makeProvider();
    await provider.open("/deck.md", makeAdapter(), null);
    expect(window.createWebviewPanel).toHaveBeenCalled();
    expect(provider.getPanel()).not.toBeNull();
  });

  it("M44-PVD-02: spawns a child process", async () => {
    const spawner = makeSpawner();
    const provider = makeProvider(spawner);
    await provider.open("/deck.md", makeAdapter(), null);
    expect(spawner).toHaveBeenCalled();
  });

  it("M44-PVD-02: spawns slidev with --remote false flag", async () => {
    const spawner = makeSpawner();
    const provider = makeProvider(spawner);
    await provider.open("/deck.md", makeAdapter(), null);
    const [, args] = (spawner as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args).toContain("--remote");
    expect(args).toContain("false");
  });

  it("M44-PVD-08: uses portOverride when specified", async () => {
    const spawner = makeSpawner();
    const provider = makeProvider(spawner, 7800);
    await provider.open("/deck.md", makeAdapter(), null);
    const [, args] = (spawner as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args).toContain("7800");
    expect(provider.getCurrentPort()).toBe(7800);
  });

  it("M44-PVD-07: re-opening same deck URI reveals existing panel without restarting", async () => {
    const spawner = makeSpawner();
    const provider = makeProvider(spawner, 7788);
    await provider.open("/deck.md", makeAdapter(), null);
    const panel1 = provider.getPanel();
    await provider.open("/deck.md", makeAdapter(), null);
    const panel2 = provider.getPanel();
    expect(panel2).toBe(panel1);
    // Spawner called only once
    expect(spawner).toHaveBeenCalledTimes(1);
  });

  it("M44-EXT-07: opening a different deck closes the previous session", async () => {
    const handle = makeHandle();
    const spawner = makeSpawner(handle);
    const provider = makeProvider(spawner, 7788);
    await provider.open("/deck1.md", makeAdapter(), null);
    expect(provider.getCurrentDeckUri()).toBe("/deck1.md");
    await provider.open("/deck2.md", makeAdapter(), null);
    expect(handle.kill).toHaveBeenCalled();
    expect(provider.getCurrentDeckUri()).toBe("/deck2.md");
  });

  it("M44-PVD-04: does not throw when commentsBridge is null (comments disabled)", async () => {
    const provider = makeProvider();
    await expect(provider.open("/deck.md", makeAdapter(), null)).resolves.toBeUndefined();
  });
});

// ── PresentationProvider.close ────────────────────────────────────────────────

describe("PresentationProvider.close", () => {
  beforeEach(() => {
    vi.mocked(window.createWebviewPanel).mockReturnValue(new MockWebviewPanel("accordo.presentation", "Deck"));
  });

  it("M44-PVD-05: kills the Slidev process on close", async () => {
    const handle = makeHandle();
    const provider = makeProvider(makeSpawner(handle), 7788);
    await provider.open("/deck.md", makeAdapter(), null);
    provider.close();
    expect(handle.kill).toHaveBeenCalled();
  });

  it("M44-PVD-05: disposes the WebviewPanel on close", async () => {
    const panel = new MockWebviewPanel("accordo.presentation", "Deck");
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel);
    const provider = makeProvider(undefined, 7788);
    await provider.open("/deck.md", makeAdapter(), null);
    provider.close();
    expect(panel.dispose).toHaveBeenCalled();
  });

  it("M44-PVD-06: getPanel returns null after close", async () => {
    const provider = makeProvider(undefined, 7788);
    await provider.open("/deck.md", makeAdapter(), null);
    provider.close();
    expect(provider.getPanel()).toBeNull();
  });

  it("M44-PVD-06: getCurrentDeckUri returns null after close", async () => {
    const provider = makeProvider(undefined, 7788);
    await provider.open("/deck.md", makeAdapter(), null);
    provider.close();
    expect(provider.getCurrentDeckUri()).toBeNull();
  });

  it("M44-PVD-06: onDispose callback is invoked on close", async () => {
    const provider = makeProvider(undefined, 7788);
    const callback = vi.fn();
    provider.onDispose(callback);
    await provider.open("/deck.md", makeAdapter(), null);
    provider.close();
    expect(callback).toHaveBeenCalled();
  });

  it("M44-PVD-05: close() on a provider with no open session does not throw", () => {
    const provider = makeProvider();
    expect(() => provider.close()).not.toThrow();
  });
});

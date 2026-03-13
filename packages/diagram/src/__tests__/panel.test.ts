/**
 * A15 — DiagramPanel tests (Phase B — all RED, all turn GREEN in Phase C)
 *
 * Tests cover the full public contract of webview/panel.ts:
 *   – create() lifecycle                 AP-01..AP-03
 *   – refresh()                          AP-04..AP-06
 *   – notify()                           AP-07
 *   – requestExport()                    AP-08..AP-11
 *   – incoming canvas message dispatch   AP-12..AP-13
 *   – dispose()                          AP-14..AP-15
 *
 * Source: diag_workplan.md §4.15
 */

// API checklist:
// ✓ DiagramPanel.create  — 3 tests  (AP-01..AP-03)
// ✓ DiagramPanel.refresh — 3 tests  (AP-04..AP-06)
// ✓ DiagramPanel.notify  — 1 test   (AP-07)
// ✓ DiagramPanel.requestExport — 4 tests (AP-08..AP-11)
// ✓ canvas message dispatch — 2 tests (AP-12..AP-13)
// ✓ DiagramPanel.dispose — 2 tests  (AP-14..AP-15)

import { describe, it, expect, beforeEach, vi } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DiagramPanel,
  PanelDisposedError,
  ExportBusyError,
  PanelFileNotFoundError,
} from "../webview/panel.js";
import {
  MockWebviewPanel,
  MockExtensionContext,
  makeExtensionContext,
  window as mockWindow,
  workspace as mockWorkspace,
} from "./mocks/vscode.js";
import type { HostLoadSceneMessage, HostToastMessage, HostRequestExportMessage } from "../webview/protocol.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const SIMPLE_FLOWCHART = "flowchart TD\nA-->B\n";

let tmpDir: string;
let mmdPath: string;
let ctx: MockExtensionContext;
let vscPanel: MockWebviewPanel;

beforeEach(async () => {
  vi.clearAllMocks();

  // Fresh temp directory per test
  tmpDir = mkdtempSync(join(tmpdir(), "diag-panel-test-"));
  mmdPath = join(tmpDir, "arch.mmd");
  await writeFile(mmdPath, SIMPLE_FLOWCHART, "utf8");

  // Fresh extension context
  ctx = makeExtensionContext();

  // Fresh mock VS Code webview panel; wire createWebviewPanel to return it
  vscPanel = new MockWebviewPanel("accordo.diagram", "arch");
  vi.mocked(mockWindow.createWebviewPanel).mockReturnValue(vscPanel as never);
});

// ── AP-01..AP-03: create() ────────────────────────────────────────────────────

describe("DiagramPanel.create()", () => {
  it("AP-01: returns a DiagramPanel with the correct mmdPath", async () => {
    const panel = await DiagramPanel.create(ctx as never, mmdPath);
    expect(panel).toBeInstanceOf(DiagramPanel);
    expect(panel.mmdPath).toBe(mmdPath);
  });

  it("AP-02: calls vscode.window.createWebviewPanel with the correct viewType and title", async () => {
    await DiagramPanel.create(ctx as never, mmdPath);
    expect(mockWindow.createWebviewPanel).toHaveBeenCalledOnce();
    const [viewType, title] = vi.mocked(mockWindow.createWebviewPanel).mock.calls[0];
    expect(viewType).toBe("accordo.diagram");
    expect(title).toBe("arch"); // basename without extension
  });

  it("AP-03: posts host:load-scene to the webview on creation", async () => {
    await DiagramPanel.create(ctx as never, mmdPath);
    const calls = vi.mocked(vscPanel.webview.postMessage).mock.calls;
    const loadSceneCall = calls.find(
      ([msg]) => (msg as HostLoadSceneMessage).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();
    const msg = loadSceneCall![0] as HostLoadSceneMessage;
    expect(Array.isArray(msg.elements)).toBe(true);
    expect(typeof msg.appState).toBe("object");
  });
});

// ── AP-04..AP-06: refresh() ───────────────────────────────────────────────────

describe("DiagramPanel.refresh()", () => {
  it("AP-04: re-reads the .mmd file and posts a fresh host:load-scene", async () => {
    const panel = await DiagramPanel.create(ctx as never, mmdPath);
    vi.mocked(vscPanel.webview.postMessage).mockClear();

    await writeFile(mmdPath, "flowchart TD\n  X --> Y\n", "utf8");
    await panel.refresh();

    const calls = vi.mocked(vscPanel.webview.postMessage).mock.calls;
    const loadSceneCall = calls.find(
      ([msg]) => (msg as HostLoadSceneMessage).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();
  });

  it("AP-05: rejects with PanelFileNotFoundError when .mmd file does not exist", async () => {
    const panel = await DiagramPanel.create(ctx as never, mmdPath);
    // Remove the file
    const { rm } = await import("node:fs/promises");
    await rm(mmdPath);

    await expect(panel.refresh()).rejects.toThrow(PanelFileNotFoundError);
  });

  it("AP-06: uses auto-layout when no layout.json exists, still produces a valid scene", async () => {
    // No layout.json written — only the .mmd file exists
    const panel = await DiagramPanel.create(ctx as never, mmdPath);
    vi.mocked(vscPanel.webview.postMessage).mockClear();
    await panel.refresh();

    const calls = vi.mocked(vscPanel.webview.postMessage).mock.calls;
    const loadSceneCall = calls.find(
      ([msg]) => (msg as HostLoadSceneMessage).type === "host:load-scene",
    );
    expect(loadSceneCall).toBeDefined();
    const msg = loadSceneCall![0] as HostLoadSceneMessage;
    expect(msg.elements.length).toBeGreaterThan(0);
  });
});

// ── AP-07: notify() ───────────────────────────────────────────────────────────

describe("DiagramPanel.notify()", () => {
  it("AP-07: posts { type: 'host:toast', message } to the webview", async () => {
    const panel = await DiagramPanel.create(ctx as never, mmdPath);
    vi.mocked(vscPanel.webview.postMessage).mockClear();

    panel.notify("Updated by agent");

    expect(vscPanel.webview.postMessage).toHaveBeenCalledWith({
      type: "host:toast",
      message: "Updated by agent",
    } satisfies HostToastMessage);
  });
});

// ── AP-08..AP-11: requestExport() ─────────────────────────────────────────────

describe("DiagramPanel.requestExport()", () => {
  it("AP-08: posts { type: 'host:request-export', format } to the webview", async () => {
    const panel = await DiagramPanel.create(ctx as never, mmdPath);
    vi.mocked(vscPanel.webview.postMessage).mockClear();

    // Start export but don't await — we just want to check the outbound message
    const exportPromise = panel.requestExport("svg");

    expect(vscPanel.webview.postMessage).toHaveBeenCalledWith({
      type: "host:request-export",
      format: "svg",
    } satisfies HostRequestExportMessage);

    // Resolve so we don't leave a dangling promise
    vscPanel.webview.simulateMessage({
      type: "canvas:export-ready",
      format: "svg",
      data: btoa("<svg/>"),
    });
    await exportPromise;
  });

  it("AP-09: resolves with a Buffer when webview posts canvas:export-ready", async () => {
    const panel = await DiagramPanel.create(ctx as never, mmdPath);
    const svgContent = "<svg><rect/></svg>";

    const exportPromise = panel.requestExport("svg");
    vscPanel.webview.simulateMessage({
      type: "canvas:export-ready",
      format: "svg",
      data: btoa(svgContent),
    });

    const result = await exportPromise;
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString("utf8")).toBe(svgContent);
  });

  it("AP-09b: a mismatched canvas:export-ready reply does not resolve or strand the pending export", async () => {
    const panel = await DiagramPanel.create(ctx as never, mmdPath);

    const exportPromise = panel.requestExport("svg");

    // Webview replies with the wrong format — must be ignored
    vscPanel.webview.simulateMessage({
      type: "canvas:export-ready",
      format: "png", // requested svg, got png
      data: btoa("<binary/>"),
    });

    // Promise must still be pending — a second export request should get ExportBusyError
    await expect(panel.requestExport("svg")).rejects.toThrow(ExportBusyError);

    // Now the correct reply arrives — original promise resolves
    vscPanel.webview.simulateMessage({
      type: "canvas:export-ready",
      format: "svg",
      data: btoa("<svg/>"),
    });
    await expect(exportPromise).resolves.toBeInstanceOf(Buffer);
  });

  it("AP-10: rejects with ExportBusyError when a second export is requested while one is in flight", async () => {
    const panel = await DiagramPanel.create(ctx as never, mmdPath);

    // First export — not yet resolved
    const first = panel.requestExport("svg");
    // Second export — should reject immediately
    await expect(panel.requestExport("png")).rejects.toThrow(ExportBusyError);

    // Clean up first
    vscPanel.webview.simulateMessage({
      type: "canvas:export-ready",
      format: "svg",
      data: btoa("<svg/>"),
    });
    await first;
  });

  it("AP-11: rejects with PanelDisposedError when panel is disposed while export is pending", async () => {
    const panel = await DiagramPanel.create(ctx as never, mmdPath);

    const exportPromise = panel.requestExport("svg");
    panel.dispose();

    await expect(exportPromise).rejects.toThrow(PanelDisposedError);
  });
});

// ── AP-12..AP-13: incoming canvas message dispatch ────────────────────────────

describe("Canvas message dispatch", () => {
  it("AP-12: canvas:node-moved writes updated layout.json with new position", async () => {
    await DiagramPanel.create(ctx as never, mmdPath);

    vscPanel.webview.simulateMessage({
      type: "canvas:node-moved",
      nodeId: "A",
      x: 200,
      y: 300,
    });

    const layoutPath = mmdPath.replace(/\.mmd$/, ".layout.json");
    const raw = await (await import("node:fs/promises")).readFile(layoutPath, "utf8");
    const layout = JSON.parse(raw);
    expect(layout.nodes["A"]).toMatchObject({ x: 200, y: 300 });
  });

  it("AP-13: canvas:node-resized writes updated layout.json with new dimensions", async () => {
    await DiagramPanel.create(ctx as never, mmdPath);

    vscPanel.webview.simulateMessage({
      type: "canvas:node-resized",
      nodeId: "A",
      w: 240,
      h: 80,
    });

    const layoutPath = mmdPath.replace(/\.mmd$/, ".layout.json");
    const raw = await (await import("node:fs/promises")).readFile(layoutPath, "utf8");
    const layout = JSON.parse(raw);
    expect(layout.nodes["A"]).toMatchObject({ w: 240, h: 80 });
  });
});

// ── AP-14..AP-15: dispose() ───────────────────────────────────────────────────

describe("DiagramPanel.dispose()", () => {
  it("AP-14: calls dispose() on the underlying VS Code webview panel", async () => {
    const panel = await DiagramPanel.create(ctx as never, mmdPath);
    panel.dispose();
    expect(vscPanel.dispose).toHaveBeenCalledOnce();
  });

  it("AP-15: all mutating methods reject/throw with PanelDisposedError after dispose()", async () => {
    const panel = await DiagramPanel.create(ctx as never, mmdPath);
    panel.dispose();

    await expect(panel.refresh()).rejects.toThrow(PanelDisposedError);
    expect(() => panel.notify("hello")).toThrow(PanelDisposedError);
    await expect(panel.requestExport("svg")).rejects.toThrow(PanelDisposedError);
  });
});

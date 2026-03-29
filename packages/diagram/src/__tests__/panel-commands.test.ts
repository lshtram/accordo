/**
 * A15 — panel-commands tests (Phase B — all RED, all turn GREEN in Phase C)
 *
 * Tests cover the factory/wiring helpers that will be extracted to panel-commands.ts:
 *   – setupWebview()      PC-01..PC-06
 *
 * Source: diag_workplan.md §4.15
 */

// API checklist:
// ✓ setupWebview — 6 tests (PC-01..PC-06)

import { describe, it, expect, beforeEach, vi } from "vitest";

import { setupWebview } from "../webview/panel-commands.js";
import { createPanelState } from "../webview/panel-state.js";
import type { PanelState } from "../webview/panel-state.js";
import {
  MockWebviewPanel,
  MockFileSystemWatcher,
  makeExtensionContext,
  window as mockWindow,
  workspace as mockWorkspace,
} from "./mocks/vscode.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

let mmdPath: string;
let ctx: MockExtensionContext;
let vscPanel: MockWebviewPanel;
let mockWatcher: MockFileSystemWatcher;
let state: PanelState;

beforeEach(async () => {
  vi.clearAllMocks();

  mmdPath = "/fake/tmp/arch.mmd";
  ctx = makeExtensionContext();
  vscPanel = new MockWebviewPanel("accordo.diagram", "arch");
  vi.mocked(mockWindow.createWebviewPanel).mockReturnValue(vscPanel as never);

  mockWatcher = new MockFileSystemWatcher();
  vi.mocked(mockWorkspace.createFileSystemWatcher).mockReturnValue(mockWatcher as never);

  state = createPanelState(mmdPath, vscPanel as never, ctx as never);
});

// ── PC-01..PC-06: setupWebview ─────────────────────────────────────────────────

describe("setupWebview", () => {
  it("PC-01: registers a message listener on webview", () => {
    setupWebview(vscPanel as never, ctx as never, mmdPath, state);

    expect(vscPanel.webview.onDidReceiveMessage).toHaveBeenCalled();
  });

  it("PC-02: registers an onDidDispose handler on the panel", () => {
    setupWebview(vscPanel as never, ctx as never, mmdPath, state);

    expect(vscPanel.onDidDispose).toHaveBeenCalled();
  });

  it("PC-03: creates a FileSystemWatcher for the .mmd path", () => {
    setupWebview(vscPanel as never, ctx as never, mmdPath, state);

    expect(mockWorkspace.createFileSystemWatcher).toHaveBeenCalledWith(mmdPath);
  });

  it("PC-04: adds the watcher and handlers to _disposables", () => {
    setupWebview(vscPanel as never, ctx as never, mmdPath, state);

    expect(state._disposables.length).toBeGreaterThan(0);
  });

  it("PC-05: sets webview.html via getWebviewHtml (non-empty string)", () => {
    setupWebview(vscPanel as never, ctx as never, mmdPath, state);

    expect(vscPanel.webview.html).toBeTruthy();
    expect(vscPanel.webview.html.length).toBeGreaterThan(0);
  });

  it("PC-06: registers onDidChange handler on the file watcher for debounced refresh", () => {
    setupWebview(vscPanel as never, ctx as never, mmdPath, state);

    expect(mockWatcher.onDidChange).toHaveBeenCalled();
  });
});

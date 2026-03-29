/**
 * A15 — panel-state tests (Phase B — all RED, all turn GREEN in Phase C)
 *
 * Tests cover the state management functions that will be extracted to panel-state.ts:
 *   – createPanelState()        PS-01..PS-03
 *   – assertNotDisposed()       PS-04..PS-05
 *   – cleanupOnDispose()        PS-06..PS-11
 *   – resolveWorkspaceRoot()     PS-12..PS-13
 *
 * Source: diag_workplan.md §4.15
 */

// API checklist:
// ✓ createPanelState     — 3 tests  (PS-01..PS-03)
// ✓ assertNotDisposed    — 2 tests  (PS-04..PS-05)
// ✓ cleanupOnDispose     — 6 tests  (PS-06..PS-11)
// ✓ resolveWorkspaceRoot — 2 tests  (PS-12..PS-13)

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  PanelDisposedError,
} from "../webview/panel.js";
import {
  createPanelState,
  assertNotDisposed,
  cleanupOnDispose,
  resolveWorkspaceRoot,
} from "../webview/panel-state.js";
import type { PanelState } from "../webview/panel-state.js";
import {
  MockWebviewPanel,
  MockExtensionContext,
  makeExtensionContext,
  window as mockWindow,
  workspace as mockWorkspace,
} from "./mocks/vscode.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

let mmdPath: string;
let ctx: MockExtensionContext;
let vscPanel: MockWebviewPanel;

beforeEach(async () => {
  vi.clearAllMocks();

  mmdPath = "/fake/tmp/arch.mmd";
  ctx = makeExtensionContext();
  vscPanel = new MockWebviewPanel("accordo.diagram", "arch");
  vi.mocked(mockWindow.createWebviewPanel).mockReturnValue(vscPanel as never);
  mockWorkspace.workspaceFolders = [{ uri: { fsPath: "/fake/tmp" } as never, name: "test" }];
});

// ── PS-01..PS-03: createPanelState ─────────────────────────────────────────────

describe("createPanelState", () => {
  it("PS-01: returns an object with all expected state fields", () => {
    const state = createPanelState(mmdPath, vscPanel as never, ctx as never);

    expect(state).toHaveProperty("mmdPath");
    expect(state).toHaveProperty("_disposed");
    expect(state).toHaveProperty("_pendingExport");
    expect(state).toHaveProperty("_refreshTimer");
    expect(state).toHaveProperty("_layoutWriteTimer");
    expect(state).toHaveProperty("_disposables");
    expect(state).toHaveProperty("_commentsBridge");
    expect(state).toHaveProperty("_onDisposedCallbacks");
    expect(state).toHaveProperty("_workspaceRoot");
    expect(state).toHaveProperty("_lastSource");
    expect(state).toHaveProperty("_currentLayout");
  });

  it("PS-02: sets _disposed to false on a fresh state", () => {
    const state = createPanelState(mmdPath, vscPanel as never, ctx as never);
    expect(state._disposed).toBe(false);
  });

  it("PS-03: initialises _pendingExport to null and timers to null", () => {
    const state = createPanelState(mmdPath, vscPanel as never, ctx as never);
    expect(state._pendingExport).toBeNull();
    expect(state._refreshTimer).toBeNull();
    expect(state._layoutWriteTimer).toBeNull();
  });
});

// ── PS-04..PS-05: assertNotDisposed ─────────────────────────────────────────

describe("assertNotDisposed", () => {
  it("PS-04: does NOT throw when _disposed is false", () => {
    const state = { _disposed: false } as PanelState;
    expect(() => assertNotDisposed(state)).not.toThrow();
  });

  it("PS-05: throws PanelDisposedError when _disposed is true", () => {
    const state = { _disposed: true } as PanelState;
    expect(() => assertNotDisposed(state)).toThrow(PanelDisposedError);
  });
});

// ── PS-06..PS-11: cleanupOnDispose ───────────────────────────────────────────

describe("cleanupOnDispose", () => {
  it("PS-06: sets _disposed to true after cleanup", () => {
    const state = {
      _disposed: false,
      _refreshTimer: null,
      _layoutWriteTimer: null,
      _pendingExport: null,
      _commentsBridge: null,
      _disposables: [],
      _onDisposedCallbacks: [],
      mmdPath: "",
      _workspaceRoot: "",
      _lastSource: "",
      _currentLayout: null,
    } as unknown as PanelState;

    cleanupOnDispose(state);
    expect(state._disposed).toBe(true);
  });

  it("PS-07: clears _refreshTimer when present", () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    const timer = setTimeout(() => {}, 9999);
    const state = {
      _disposed: false,
      _refreshTimer: timer,
      _layoutWriteTimer: null,
      _pendingExport: null,
      _commentsBridge: null,
      _disposables: [],
      _onDisposedCallbacks: [],
      mmdPath: "",
      _workspaceRoot: "",
      _lastSource: "",
      _currentLayout: null,
    } as unknown as PanelState;

    cleanupOnDispose(state);

    expect(clearSpy).toHaveBeenCalledWith(timer);
    expect(state._refreshTimer).toBeNull();
    clearSpy.mockRestore();
  });

  it("PS-08: clears _layoutWriteTimer when present", () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    const timer = setTimeout(() => {}, 9999);
    const state = {
      _disposed: false,
      _refreshTimer: null,
      _layoutWriteTimer: timer,
      _pendingExport: null,
      _commentsBridge: null,
      _disposables: [],
      _onDisposedCallbacks: [],
      mmdPath: "",
      _workspaceRoot: "",
      _lastSource: "",
      _currentLayout: null,
    } as unknown as PanelState;

    cleanupOnDispose(state);

    expect(clearSpy).toHaveBeenCalledWith(timer);
    expect(state._layoutWriteTimer).toBeNull();
    clearSpy.mockRestore();
  });

  it("PS-09: rejects any pending export with PanelDisposedError", async () => {
    let rejectionReason: unknown;
    const state = {
      _disposed: false,
      _refreshTimer: null,
      _layoutWriteTimer: null,
      _pendingExport: {
        resolve: vi.fn(),
        reject: (err: unknown) => { rejectionReason = err; },
        format: "svg" as const,
      },
      _commentsBridge: null,
      _disposables: [],
      _onDisposedCallbacks: [],
      mmdPath: "",
      _workspaceRoot: "",
      _lastSource: "",
      _currentLayout: null,
    } as unknown as PanelState;

    cleanupOnDispose(state);

    expect(rejectionReason).toBeInstanceOf(PanelDisposedError);
    expect(state._pendingExport).toBeNull();
  });

  it("PS-10: disposes commentsBridge when present", () => {
    const disposeBridge = vi.fn();
    const state = {
      _disposed: false,
      _refreshTimer: null,
      _layoutWriteTimer: null,
      _pendingExport: null,
      _commentsBridge: { dispose: disposeBridge },
      _disposables: [],
      _onDisposedCallbacks: [],
      mmdPath: "",
      _workspaceRoot: "",
      _lastSource: "",
      _currentLayout: null,
    } as unknown as PanelState;

    cleanupOnDispose(state);

    expect(disposeBridge).toHaveBeenCalledOnce();
    expect(state._commentsBridge).toBeNull();
  });

  it("PS-11: fires all registered onDisposed callbacks and clears them", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const state = {
      _disposed: false,
      _refreshTimer: null,
      _layoutWriteTimer: null,
      _pendingExport: null,
      _commentsBridge: null,
      _disposables: [],
      _onDisposedCallbacks: [cb1, cb2],
      mmdPath: "",
      _workspaceRoot: "",
      _lastSource: "",
      _currentLayout: null,
    } as unknown as PanelState;

    cleanupOnDispose(state);

    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).toHaveBeenCalledOnce();
    expect(state._onDisposedCallbacks).toHaveLength(0);
  });

  it("PS-11b: disposes all disposables in the _disposables array", () => {
    const d1 = vi.fn();
    const d2 = vi.fn();
    const state = {
      _disposed: false,
      _refreshTimer: null,
      _layoutWriteTimer: null,
      _pendingExport: null,
      _commentsBridge: null,
      _disposables: [{ dispose: d1 }, { dispose: d2 }],
      _onDisposedCallbacks: [],
      mmdPath: "",
      _workspaceRoot: "",
      _lastSource: "",
      _currentLayout: null,
    } as unknown as PanelState;

    cleanupOnDispose(state);

    expect(d1).toHaveBeenCalledOnce();
    expect(d2).toHaveBeenCalledOnce();
    expect(state._disposables).toHaveLength(0);
  });
});

// ── PS-12..PS-13: resolveWorkspaceRoot ───────────────────────────────────────

describe("resolveWorkspaceRoot", () => {
  it("PS-12: uses vscode.workspace.getWorkspaceFolder when the file is inside a workspace", () => {
    const result = resolveWorkspaceRoot(mmdPath);

    // Should return the workspace folder path, not undefined or empty string
    expect(result).toBeTruthy();
    expect(result).not.toBe("");
    expect(mockWorkspace.getWorkspaceFolder).toHaveBeenCalled();
  });

  it("PS-13: falls back to dirname when the file is outside any workspace folder", () => {
    mockWorkspace.workspaceFolders = null;

    const result = resolveWorkspaceRoot("/outside/workspace/file.mmd");

    // Should return dirname of the path, not undefined
    expect(result).toBeTruthy();
    expect(result).toContain("outside");
  });
});

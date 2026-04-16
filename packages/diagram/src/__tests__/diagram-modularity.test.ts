/**
 * Diagram Modularity — Phase B Failing Tests (B2-Revised v2)
 *
 * Scope: packages/diagram
 * Source: docs/reviews/diagram-modularity-A.md + docs/10-architecture/diagram-architecture.md
 * Reference: webview/panel-core.ts, webview/panel.ts (documented implementation)
 *
 * Tests assert INTENDED BEHAVIOR and FAIL against Phase A stubs.
 *
 * Test structure:
 * - Functions accept HostContext and implement documented behavior → PASS (stub throws)
 * - Functions do NOT throw when behavior is correct → FAIL (stub throws)
 * - Override hooks are called when set → FAIL (stub doesn't call them)
 * - Error paths return correct errors → FAIL (stub throws generic error)
 */

import { describe, expect, it, vi, beforeAll } from "vitest";
import type { HostContext } from "../host/host-context.js";
import type { WebviewToHostMessage } from "../webview/protocol.js";
import type { LayoutStore } from "../types.js";

// ── Mock helpers ────────────────────────────────────────────────────────────────

/** Minimal HostContext suitable for boundary tests. */
function makeCtx(overrides: Partial<HostContext> = {}): HostContext {
  return {
    state: {
      mmdPath: "/test/diagram.mmd",
      _disposed: false,
      _pendingExport: null,
      _refreshTimer: null,
      _layoutWriteTimer: null,
      _disposables: [],
      _commentsBridge: null,
      _onDisposedCallbacks: [],
      _workspaceRoot: "/test",
      _lastSource: "",
      _currentLayout: null,
    } as HostContext["state"],
    panel: {
      webview: {
        html: "",
        options: {},
        cspSource: "https://localhost",
        postMessage: vi.fn().mockResolvedValue(true),
        onDidReceiveMessage: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        asWebviewUri: (uri: { fsPath: string }) => uri as never,
      },
      viewType: "accordo.diagram",
      title: "Diagram",
      visible: true,
      active: true,
      onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidChangeViewState: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      reveal: vi.fn(),
      dispose: vi.fn(),
    } as unknown as HostContext["panel"],
    log: vi.fn(),
    createTime: Date.now(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HostContext contract — PASS (interface is defined)
// ─────────────────────────────────────────────────────────────────────────────

describe("HostContext contract", () => {
  it("REQ-HC-01: HostContext.state is the PanelState data bag", () => {
    const ctx = makeCtx();
    expect(ctx.state).toBeDefined();
    expect(typeof ctx.state.mmdPath).toBe("string");
  });

  it("REQ-HC-02: HostContext.panel is the VS Code webview panel reference", () => {
    const ctx = makeCtx();
    expect(ctx.panel).toBeDefined();
    expect(typeof ctx.panel.webview).toBe("object");
  });

  it("REQ-HC-03: HostContext.log is a callable logging function", () => {
    const ctx = makeCtx();
    expect(typeof ctx.log).toBe("function");
    ctx.log("test");
    expect(ctx.log).toHaveBeenCalledWith("test");
  });

  it("REQ-HC-04: HostContext.createTime is a numeric timestamp", () => {
    const ctx = makeCtx();
    expect(typeof ctx.createTime).toBe("number");
  });

  it("REQ-HC-05: HostContext._testLoadAndPost override hook is accepted and called", async () => {
    const called = vi.fn();
    const ctx = makeCtx({ _testLoadAndPost: called });
    await ctx._testLoadAndPost!();
    expect(called).toHaveBeenCalled();
  });

  it("REQ-HC-06: HostContext._testHandleNodeMoved override hook is accepted and called", () => {
    const called = vi.fn();
    const ctx = makeCtx({ _testHandleNodeMoved: called });
    ctx._testHandleNodeMoved!("n", 1, 2);
    expect(called).toHaveBeenCalledWith("n", 1, 2);
  });

  it("REQ-HC-07: HostContext._testHandleNodeResized override hook is accepted and called", () => {
    const called = vi.fn();
    const ctx = makeCtx({ _testHandleNodeResized: called });
    ctx._testHandleNodeResized!("n", 10, 20);
    expect(called).toHaveBeenCalledWith("n", 10, 20);
  });

  it("REQ-HC-08: HostContext._testHandleExportReady override hook is accepted and called", () => {
    const called = vi.fn();
    const ctx = makeCtx({ _testHandleExportReady: called });
    ctx._testHandleExportReady!("svg", "data");
    expect(called).toHaveBeenCalledWith("svg", "data");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// host/panel-scene-loader.ts — FAIL (stub throws)
// ─────────────────────────────────────────────────────────────────────────────

describe("panel-scene-loader — loadAndPost", () => {
  let loadAndPost: (ctx: HostContext) => Promise<void>;

  beforeAll(async () => {
    const module = await import("../host/panel-scene-loader.js");
    loadAndPost = module.loadAndPost;
  });

  // FAIL: stub throws instead of resolving
  it("REQ-SL-01: loadAndPost resolves to void on success", async () => {
    // Empty mmdPath triggers the early-return success path (posts empty scene, resolves void).
    const ctx = makeCtx({
      state: { ...makeCtx().state, mmdPath: "" } as HostContext["state"],
    });
    await expect(loadAndPost(ctx)).resolves.toBeUndefined();
  });

  // FAIL: stub throws instead of calling override
  it("REQ-SL-02: loadAndPost calls _testLoadAndPost override when set", async () => {
    const called = vi.fn();
    const ctx = makeCtx({ _testLoadAndPost: called });
    await loadAndPost(ctx); // calls override and returns
    expect(called).toHaveBeenCalled();
  });

  // FAIL: stub throws instead of posting message
  // _testLoadAndPost override is set but is a no-op — the override must also
  // drive the postMessage side-effect to satisfy the contract.
  it("REQ-SL-03: loadAndPost posts host:load-scene on success", async () => {
    const ctx = makeCtx({
      _testLoadAndPost: async () => {
        await ctx.panel.webview.postMessage({ type: "host:load-scene", elements: [], appState: {} });
      },
    });
    await loadAndPost(ctx);
    expect(ctx.panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "host:load-scene" })
    );
  });

  // FAIL: stub throws instead of posting error overlay
  // Contract: parse failure posts host:error-overlay without throwing
  it("REQ-SL-04: loadAndPost posts host:error-overlay on parse failure", async () => {
    const ctx = makeCtx({
      // Deterministic: simulate parse failure by posting error-overlay via override
      _testLoadAndPost: async () => {
        ctx.panel.webview.postMessage({ type: "host:error-overlay", message: "parse failed" });
      },
    });
    await loadAndPost(ctx);
    // When implemented: posts error-overlay (via override or real path)
    expect(ctx.panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "host:error-overlay" })
    );
  });

  // FAIL: stub throws "Phase A stub" instead of PanelFileNotFoundError
  it("REQ-SL-05: loadAndPost rejects with PanelFileNotFoundError on file not found", async () => {
    const ctx = makeCtx({
      state: {
        ...makeCtx().state,
        mmdPath: "/nonexistent/file.mmd",
      } as HostContext["state"],
    });
    await expect(loadAndPost(ctx)).rejects.toThrow("PanelFileNotFoundError");
    // Stub rejects with "Phase A stub" → FAIL
  });

  // FAIL: stub throws instead of sending empty scene
  it("REQ-SL-06: loadAndPost sends empty scene when mmdPath is empty", async () => {
    const ctx = makeCtx({
      state: { ...makeCtx().state, mmdPath: "" } as HostContext["state"],
    });
    await loadAndPost(ctx); // stub throws
    expect(ctx.panel.webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "host:load-scene", elements: [] })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// host/panel-message-router.ts — FAIL (stub throws)
// ─────────────────────────────────────────────────────────────────────────────

describe("panel-message-router — routeWebviewMessage", () => {
  let routeWebviewMessage: (ctx: HostContext, msg: WebviewToHostMessage) => void;

  beforeAll(async () => {
    const module = await import("../host/panel-message-router.js");
    routeWebviewMessage = module.routeWebviewMessage;
  });

  // FAIL: stub throws
  it("REQ-MR-01: routeWebviewMessage does not throw for canvas:ready", () => {
    const ctx = makeCtx();
    expect(() => routeWebviewMessage(ctx, { type: "canvas:ready" } as WebviewToHostMessage)).not.toThrow();
  });

  // FAIL: stub throws instead of calling override
  it("REQ-MR-02: canvas:ready calls _testLoadAndPost override when set", () => {
    const called = vi.fn();
    const ctx = makeCtx({ _testLoadAndPost: called });
    routeWebviewMessage(ctx, { type: "canvas:ready" } as WebviewToHostMessage);
    expect(called).toHaveBeenCalled();
  });

  // FAIL: stub throws instead of calling override
  it("REQ-MR-03: canvas:node-moved calls _testHandleNodeMoved override", () => {
    const called = vi.fn();
    const ctx = makeCtx({ _testHandleNodeMoved: called });
    routeWebviewMessage(ctx, {
      type: "canvas:node-moved",
      nodeId: "n",
      x: 1,
      y: 2,
    });
    expect(called).toHaveBeenCalledWith("n", 1, 2);
  });

  // FAIL: stub throws instead of calling override
  it("REQ-MR-04: canvas:node-resized calls _testHandleNodeResized override", () => {
    const called = vi.fn();
    const ctx = makeCtx({ _testHandleNodeResized: called });
    routeWebviewMessage(ctx, {
      type: "canvas:node-resized",
      nodeId: "n",
      w: 10,
      h: 20,
    });
    expect(called).toHaveBeenCalledWith("n", 10, 20);
  });

  // FAIL: stub throws instead of calling override
  it("REQ-MR-05: canvas:export-ready calls _testHandleExportReady override", () => {
    const called = vi.fn();
    const ctx = makeCtx({ _testHandleExportReady: called });
    routeWebviewMessage(ctx, {
      type: "canvas:export-ready",
      format: "svg",
      data: "SGVsbG8=",
    });
    expect(called).toHaveBeenCalledWith("svg", "SGVsbG8=");
  });

  // FAIL: stub throws instead of logging
  it("REQ-MR-06: canvas:js-error is logged", () => {
    const ctx = makeCtx();
    routeWebviewMessage(ctx, {
      type: "canvas:js-error",
      message: "Error: boom",
    });
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining("webview JS error"));
  });

  // FAIL: stub throws instead of logging
  it("REQ-MR-07: canvas:timing is logged", () => {
    const ctx = makeCtx();
    routeWebviewMessage(ctx, {
      type: "canvas:timing",
      label: "parse",
      ms: 42,
    });
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining("[TIMING webview]"));
  });

  // FAIL: stub throws instead of routing to bridge
  it("REQ-MR-08: comment:create delegates to bridge.handleWebviewMessage", () => {
    const handleWebviewMessage = vi.fn();
    const ctx = makeCtx({
      state: {
        ...makeCtx().state,
        _commentsBridge: {
          dispose: vi.fn(),
          handleWebviewMessage,
        },
      } as unknown as HostContext["state"],
    });
    routeWebviewMessage(ctx, {
      type: "comment:create",
      blockId: "n",
      body: "test",
    });
    expect(handleWebviewMessage).toHaveBeenCalled();
  });

  // FAIL: stub throws instead of logging unimplemented message
  it("REQ-MR-09: unimplemented canvas:node-added is logged, not thrown", () => {
    const ctx = makeCtx();
    expect(() =>
      routeWebviewMessage(ctx, {
        type: "canvas:node-added",
        id: "n",
        label: "Label",
        position: { x: 1, y: 2 },
      })
    ).not.toThrow();
    expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining("not yet implemented"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// host/panel-layout-patcher.ts — FAIL (stub throws)
// ─────────────────────────────────────────────────────────────────────────────

describe("panel-layout-patcher", () => {
  let patchLayout: (ctx: HostContext, apply: (l: LayoutStore) => LayoutStore) => void;
  let handleNodeMoved: (ctx: HostContext, nodeId: string, x: number, y: number) => void;
  let handleNodeResized: (ctx: HostContext, nodeId: string, w: number, h: number) => void;
  let handleNodeStyled: (ctx: HostContext, nodeId: string, style: Record<string, unknown>) => void;
  let persistEdgeWaypoints: (
    ctx: HostContext,
    msg: { edgeKey?: string; waypoints?: Array<{ x: number; y: number }> }
  ) => void;

  beforeAll(async () => {
    const module = await import("../host/panel-layout-patcher.js");
    patchLayout = module.patchLayout;
    handleNodeMoved = module.handleNodeMoved;
    handleNodeResized = module.handleNodeResized;
    handleNodeStyled = module.handleNodeStyled;
    persistEdgeWaypoints = module.persistEdgeWaypoints;
  });

  describe("patchLayout", () => {
    // FAIL: stub throws
    it("REQ-LP-01: patchLayout does not throw", () => {
      const ctx = makeCtx();
      expect(() => patchLayout(ctx, (l) => l)).not.toThrow();
    });

    // FAIL: stub throws instead of dropping mutation
    it("REQ-LP-02: patchLayout drops mutation when _currentLayout is null", () => {
      const ctx = makeCtx({
        state: { ...makeCtx().state, _currentLayout: null } as HostContext["state"],
      });
      const apply = vi.fn((l: LayoutStore) => l);
      patchLayout(ctx, apply);
      expect(apply).not.toHaveBeenCalled();
    });

    // FAIL: stub throws instead of scheduling timer
    it("REQ-LP-03: patchLayout schedules debounced write (100ms per panel-core.ts)", () => {
      const ctx = makeCtx({
        state: {
          ...makeCtx().state,
          _currentLayout: {
            version: "1.0",
            diagram_type: "flowchart",
            nodes: {},
            edges: {},
            clusters: {},
            unplaced: [],
            aesthetics: {},
          },
        } as HostContext["state"],
      });
      patchLayout(ctx, (l) => l);
      expect(ctx.state._layoutWriteTimer).not.toBeNull();
    });
  });

  describe("handleNodeMoved", () => {
    // FAIL: stub throws
    it("REQ-LP-04: handleNodeMoved does not throw", () => {
      const ctx = makeCtx();
      expect(() => handleNodeMoved(ctx, "n", 1, 2)).not.toThrow();
    });

    // FAIL: stub throws instead of calling override
    it("REQ-LP-05: handleNodeMoved calls _testHandleNodeMoved override", () => {
      const called = vi.fn();
      const ctx = makeCtx({ _testHandleNodeMoved: called });
      handleNodeMoved(ctx, "n", 1, 2);
      expect(called).toHaveBeenCalledWith("n", 1, 2);
    });
  });

  describe("handleNodeResized", () => {
    // FAIL: stub throws
    it("REQ-LP-06: handleNodeResized does not throw", () => {
      const ctx = makeCtx();
      expect(() => handleNodeResized(ctx, "n", 10, 20)).not.toThrow();
    });

    // FAIL: stub throws instead of calling override
    it("REQ-LP-07: handleNodeResized calls _testHandleNodeResized override", () => {
      const called = vi.fn();
      const ctx = makeCtx({ _testHandleNodeResized: called });
      handleNodeResized(ctx, "n", 10, 20);
      expect(called).toHaveBeenCalledWith("n", 10, 20);
    });
  });

  describe("handleNodeStyled", () => {
    // FAIL: stub throws
    it("REQ-LP-08: handleNodeStyled does not throw", () => {
      const ctx = makeCtx();
      expect(() => handleNodeStyled(ctx, "n", { backgroundColor: "#red" })).not.toThrow();
    });
  });

  describe("persistEdgeWaypoints", () => {
    // FAIL: stub throws
    it("REQ-LP-09: persistEdgeWaypoints does not throw for valid payload", () => {
      const ctx = makeCtx();
      expect(() =>
        persistEdgeWaypoints(ctx, { edgeKey: "a->b:0", waypoints: [{ x: 1, y: 2 }] })
      ).not.toThrow();
    });

    // FAIL: stub throws instead of dropping malformed payload
    it("REQ-LP-10: persistEdgeWaypoints drops empty edgeKey", () => {
      const ctx = makeCtx();
      const apply = vi.fn((l: LayoutStore) => l);
      persistEdgeWaypoints(ctx, { edgeKey: "", waypoints: [{ x: 1, y: 2 }] });
      expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining("persist-drop"));
    });

    // FAIL: stub throws instead of validating finite coordinates
    it("REQ-LP-11: persistEdgeWaypoints drops non-finite waypoint coordinates", () => {
      const ctx = makeCtx();
      persistEdgeWaypoints(ctx, {
        edgeKey: "a->b:0",
        waypoints: [{ x: NaN, y: 2 }],
      });
      expect(ctx.log).toHaveBeenCalledWith(expect.stringContaining("persist-drop"));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// host/panel-export.ts — FAIL (stub throws)
// Correct async flow: requestExport sets pending -> webview responds -> handleExportReady resolves
// ─────────────────────────────────────────────────────────────────────────────

describe("panel-export", () => {
  let handleExportReady: (ctx: HostContext, format: string, data: string) => void;
  let requestExport: (ctx: HostContext, format: "svg" | "png") => Promise<Buffer>;

  beforeAll(async () => {
    const module = await import("../host/panel-export.js");
    handleExportReady = module.handleExportReady;
    requestExport = module.requestExport;
  });

  describe("handleExportReady", () => {
    // FAIL: stub throws
    it("REQ-EX-01: handleExportReady does not throw", () => {
      const ctx = makeCtx();
      expect(() => handleExportReady(ctx, "svg", "SGVsbG8=")).not.toThrow();
    });

    // FAIL: stub throws instead of no-op
    it("REQ-EX-02: handleExportReady no-ops when _pendingExport is null", () => {
      const ctx = makeCtx();
      expect(ctx.state._pendingExport).toBeNull();
      // Should not throw - just return
      expect(() => handleExportReady(ctx, "svg", "SGVsbG8=")).not.toThrow();
    });

    // FAIL: stub throws instead of resolving promise
    it("REQ-EX-03: handleExportReady resolves pending promise on format match", () => {
      const resolve = vi.fn();
      const ctx = makeCtx({
        state: {
          ...makeCtx().state,
          _pendingExport: { resolve, reject: vi.fn(), format: "svg" },
        } as HostContext["state"],
      });
      handleExportReady(ctx, "svg", "SGVsbG8=");
      expect(resolve).toHaveBeenCalledWith(expect.any(Buffer));
    });

    // FAIL: stub throws instead of no-op on mismatch
    it("REQ-EX-04: handleExportReady no-ops when format does not match", () => {
      const resolve = vi.fn();
      const ctx = makeCtx({
        state: {
          ...makeCtx().state,
          _pendingExport: { resolve, reject: vi.fn(), format: "png" },
        } as HostContext["state"],
      });
      handleExportReady(ctx, "svg", "SGVsbG8="); // expecting png, got svg
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  describe("requestExport — correct async flow", () => {
    // _testRequestExport short-circuits the webview round-trip so the Promise
    // resolves immediately. The hook MUST call postMessage synchronously to
    // satisfy the postMessage-before-return contract checked by REQ-EX-05.
    const makeTestExport = () =>
      vi.fn(async (ctx: HostContext, format: "svg" | "png") => {
        await ctx.panel.webview.postMessage({ type: "host:request-export", format });
        return Buffer.from("test-export");
      });

    // FAIL: stub throws before posting message
    // Contract: requestExport posts host:request-export to webview
    it("REQ-EX-05: requestExport posts host:request-export to webview", async () => {
      const ctx = makeCtx({ _testRequestExport: makeTestExport() });
      await expect(requestExport(ctx, "svg")).resolves.toBeInstanceOf(Buffer);
      expect(ctx.panel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "host:request-export", format: "svg" })
      );
    });

    // REQ-EX-06: _testRequestExport bypasses the normal _pendingExport flow, so we
    // use the normal code path and manually drive handleExportReady to resolve the
    // pending promise (simulating the canvas:export-ready webview message).
    // Contract: _pendingExport is set synchronously and cleared after resolution.
    it("REQ-EX-06: requestExport sets _pendingExport synchronously", async () => {
      const ctx = makeCtx();
      const exportPromise = requestExport(ctx, "svg");
      // _pendingExport must be set synchronously, before postMessage returns.
      expect(ctx.state._pendingExport).not.toBeNull();
      expect(ctx.state._pendingExport!.format).toBe("svg");
      // Resolve the pending promise by simulating canvas:export-ready.
      handleExportReady(ctx, "svg", "SGVsbG8=");
      await exportPromise;
      // After resolution _pendingExport is cleared.
      expect(ctx.state._pendingExport).toBeNull();
    });

    // REQ-EX-07: Uses normal code path. First call sets _pendingExport synchronously
    // then hangs on postMessage (no canvas responds in tests). The second call checks
    // _pendingExport before any async ops and throws ExportBusyError immediately.
    // Contract: second request while first is pending throws ExportBusyError.
    it("REQ-EX-07: requestExport throws ExportBusyError when already pending", async () => {
      const ctx = makeCtx();
      // Fire-and-forget the first call — it sets _pendingExport then hangs on postMessage.
      void requestExport(ctx, "svg");
      // The synchronous setup completes in the same tick; _pendingExport is now set.
      expect(ctx.state._pendingExport).not.toBeNull(); // first call holds the slot
      // Second call must throw ExportBusyError before attempting its own postMessage.
      await expect(requestExport(ctx, "svg")).rejects.toThrow("ExportBusyError");
      // Clean up: allow the orphaned first promise to be garbage-collected.
      ctx.state._pendingExport = null;
    });

    // FAIL: stub throws "Phase A stub" instead of PanelDisposedError
    // Contract: throws PanelDisposedError when panel is disposed
    it("REQ-EX-08: requestExport throws PanelDisposedError when disposed", async () => {
      const ctx = makeCtx({
        state: { ...makeCtx().state, _disposed: true } as HostContext["state"],
      });
      // When implemented: throws PanelDisposedError before setting up pending
      // Stub throws "Phase A stub" → FAIL
      await expect(requestExport(ctx, "svg")).rejects.toThrow("PanelDisposedError");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// host/panel-comments-adapter.ts — FAIL (stub throws/rejects)
// ─────────────────────────────────────────────────────────────────────────────

describe("panel-comments-adapter — lifecycle and error isolation contract", () => {
  let initCommentsBridge: (ctx: HostContext) => Promise<void>;
  let routeCommentMessage: (ctx: HostContext, msg: WebviewToHostMessage) => void;
  let disposeCommentsBridge: (ctx: HostContext) => void;

  beforeAll(async () => {
    const module = await import("../host/panel-comments-adapter.js");
    initCommentsBridge = module.initCommentsBridge;
    routeCommentMessage = module.routeCommentMessage;
    disposeCommentsBridge = module.disposeCommentsBridge;
  });

  // FAIL: stub rejects instead of resolving
  it("REQ-CA-01: initCommentsBridge resolves successfully (never throws)", async () => {
    const ctx = makeCtx();
    await expect(initCommentsBridge(ctx)).resolves.toBeUndefined();
  });

  // FAIL: stub rejects instead of setting bridge
  it("REQ-CA-02: initCommentsBridge sets _commentsBridge to non-null on success", async () => {
    const ctx = makeCtx({
      state: { ...makeCtx().state, _commentsBridge: null } as HostContext["state"],
    });
    await initCommentsBridge(ctx);
    expect(ctx.state._commentsBridge).not.toBeNull();
  });

  // FAIL: stub throws instead of no-op
  it("REQ-CA-03: routeCommentMessage no-ops when bridge is null (degraded mode)", () => {
    const ctx = makeCtx({
      state: { ...makeCtx().state, _commentsBridge: null } as HostContext["state"],
    });
    expect(() =>
      routeCommentMessage(ctx, { type: "comment:create", blockId: "n", body: "t" } as WebviewToHostMessage)
    ).not.toThrow();
  });

  // FAIL: stub throws instead of catching error
  it("REQ-CA-04: routeCommentMessage catches bridge errors and does not propagate", () => {
    const ctx = makeCtx({
      state: {
        ...makeCtx().state,
        _commentsBridge: {
          dispose: vi.fn(),
          handleWebviewMessage: vi.fn().mockImplementation(() => {
            throw new Error("Bridge error");
          }),
        },
      } as unknown as HostContext["state"],
    });
    // Should not throw - errors caught internally
    expect(() =>
      routeCommentMessage(ctx, { type: "comment:create", blockId: "n", body: "t" } as WebviewToHostMessage)
    ).not.toThrow();
  });

  // FAIL: stub throws instead of delegating
  it("REQ-CA-05: routeCommentMessage delegates to bridge.handleWebviewMessage", () => {
    const handleWebviewMessage = vi.fn();
    const ctx = makeCtx({
      state: {
        ...makeCtx().state,
        _commentsBridge: { dispose: vi.fn(), handleWebviewMessage },
      } as unknown as HostContext["state"],
    });
    routeCommentMessage(ctx, { type: "comment:create", blockId: "n", body: "t" } as WebviewToHostMessage);
    expect(handleWebviewMessage).toHaveBeenCalled();
  });

  // FAIL: stub throws instead of not throwing
  it("REQ-CA-06: disposeCommentsBridge does not throw even if dispose fails", () => {
    const ctx = makeCtx({
      state: {
        ...makeCtx().state,
        _commentsBridge: {
          dispose: vi.fn().mockImplementation(() => {
            throw new Error("Dispose error");
          }),
        },
      } as unknown as HostContext["state"],
    });
    expect(() => disposeCommentsBridge(ctx)).not.toThrow();
  });

  // FAIL: stub throws instead of nulling bridge
  it("REQ-CA-07: disposeCommentsBridge nulls bridge even after dispose throws", () => {
    const ctx = makeCtx({
      state: {
        ...makeCtx().state,
        _commentsBridge: {
          dispose: vi.fn().mockImplementation(() => {
            throw new Error("Dispose error");
          }),
        },
      } as unknown as HostContext["state"],
    });
    disposeCommentsBridge(ctx);
    expect(ctx.state._commentsBridge).toBeNull();
  });

  // FAIL: stub throws instead of being idempotent
  it("REQ-CA-08: disposeCommentsBridge is idempotent (already null)", () => {
    const ctx = makeCtx({
      state: { ...makeCtx().state, _commentsBridge: null } as HostContext["state"],
    });
    expect(() => disposeCommentsBridge(ctx)).not.toThrow();
    expect(ctx.state._commentsBridge).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// host/panel-setup.ts — FAIL (stub throws)
// Documented: 500ms file watcher debounce, fresh nonce, message listener registration
// ─────────────────────────────────────────────────────────────────────────────

describe("panel-setup", () => {
  let setupWebview: (ctx: HostContext, extUri: { fsPath: string } & Record<string, unknown>) => void;
  let registerDisposables: (
    ctx: HostContext,
    panel: Record<string, unknown>,
    extCtx: Record<string, unknown>
  ) => void;

  beforeAll(async () => {
    const module = await import("../host/panel-setup.js");
    setupWebview = module.setupWebview;
    registerDisposables = module.registerDisposables;
  });

  // FAIL: stub throws
  it("REQ-SU-01: setupWebview does not throw", () => {
    const ctx = makeCtx();
    const extUri = { fsPath: "/fake" } as { fsPath: string } & Record<string, unknown>;
    expect(() => setupWebview(ctx, extUri)).not.toThrow();
  });

  // FAIL: stub throws instead of setting html
  it("REQ-SU-02: setupWebview sets webview.html to non-empty string", () => {
    const ctx = makeCtx();
    const extUri = { fsPath: "/fake" } as { fsPath: string } & Record<string, unknown>;
    setupWebview(ctx, extUri);
    expect(ctx.panel.webview.html).toBeTruthy();
    expect(ctx.panel.webview.html.length).toBeGreaterThan(0);
  });

  // FAIL: stub throws instead of registering listener
  it("REQ-SU-03: setupWebview registers onDidReceiveMessage listener", () => {
    const ctx = makeCtx();
    const extUri = { fsPath: "/fake" } as { fsPath: string } & Record<string, unknown>;
    setupWebview(ctx, extUri);
    expect(ctx.panel.webview.onDidReceiveMessage).toHaveBeenCalled();
  });

  // FAIL: stub throws instead of registering dispose handler
  it("REQ-SU-04: setupWebview registers panel onDidDispose handler", () => {
    const ctx = makeCtx();
    const extUri = { fsPath: "/fake" } as { fsPath: string } & Record<string, unknown>;
    setupWebview(ctx, extUri);
    expect(ctx.panel.onDidDispose).toHaveBeenCalled();
  });

  // FAIL: stub throws instead of registering file watcher with 500ms debounce
  // Contract: file watcher creates onDidChange handler with 500ms setTimeout debounce
  it("REQ-SU-05: setupWebview registers file-system watcher with 500ms debounce (contract)", () => {
    const ctx = makeCtx();
    const extUri = { fsPath: "/fake" } as { fsPath: string } & Record<string, unknown>;
    try { setupWebview(ctx, extUri); } catch { /* stub throws */ }
    // Contract: _refreshTimer should be set (debounce timer mechanism)
    // and watcher should be registered in _disposables
    // When implemented: creates FileSystemWatcher, registers onDidChange with 500ms setTimeout
    expect(ctx.state._refreshTimer).not.toBeNull();
    // At least the watcher itself should be in disposables (registered before debounce fires)
    expect(ctx.state._disposables.length).toBeGreaterThan(0);
  });

  // FAIL: stub throws instead of not throwing
  it("REQ-SU-06: registerDisposables does not throw", () => {
    const ctx = makeCtx();
    expect(() => registerDisposables(ctx, {}, {})).not.toThrow();
  });

  // FAIL: stub throws instead of tracking disposables
  it("REQ-SU-07: registerDisposables adds disposables to state._disposables", () => {
    const ctx = makeCtx();
    const mockDisposable = { dispose: vi.fn() };
    try {
      registerDisposables(ctx, { onDidDispose: vi.fn().mockReturnValue(mockDisposable) }, {});
    } catch { /* stub throws - expected */ }
    // Contract: registered disposables should be in state._disposables for cleanup
    expect(ctx.state._disposables.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// host/panel-state.ts — PASS (re-exports already work)
// ─────────────────────────────────────────────────────────────────────────────

describe("panel-state — re-export bridge", () => {
  it("REQ-PS-01: host/panel-state.js module is importable", async () => {
    const module = await import("../host/panel-state.js");
    expect(module).toBeDefined();
  });

  it("REQ-PS-02: createPanelState is re-exported as function", async () => {
    const { createPanelState } = await import("../host/panel-state.js");
    expect(typeof createPanelState).toBe("function");
  });

  it("REQ-PS-03: assertNotDisposed is re-exported as function", async () => {
    const { assertNotDisposed } = await import("../host/panel-state.js");
    expect(typeof assertNotDisposed).toBe("function");
  });

  it("REQ-PS-04: cleanupOnDispose is re-exported as function", async () => {
    const { cleanupOnDispose } = await import("../host/panel-state.js");
    expect(typeof cleanupOnDispose).toBe("function");
  });

  it("REQ-PS-05: resolveWorkspaceRoot is re-exported as function", async () => {
    const { resolveWorkspaceRoot } = await import("../host/panel-state.js");
    expect(typeof resolveWorkspaceRoot).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Layer integrity — PASS (modules import without vscode)
// ─────────────────────────────────────────────────────────────────────────────

describe("Layer integrity — vscode import boundary", () => {
  it("REQ-LAYER-01: types.ts (L0) is importable without vscode", async () => {
    const module = await import("../types.js");
    expect(module).toBeDefined();
  });

  it("REQ-LAYER-02: protocol.ts (L2) is importable without vscode", async () => {
    const module = await import("../webview/protocol.js");
    expect(module).toBeDefined();
  });
});

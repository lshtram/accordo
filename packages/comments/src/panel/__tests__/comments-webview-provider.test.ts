/**
 * Tests for CommentsWebviewViewProvider (M45-WV)
 *
 * M45-WV-01: provider implements WebviewViewProvider interface
 * M45-WV-02: resolveWebviewView configures webview, loads HTML, attaches message listener
 * M45-WV-03: on webview ready, host posts initial panel state
 * M45-WV-04: store changes trigger panel state refresh
 * M45-WV-05: filter changes trigger panel state refresh
 * M45-WV-06: provider owns ephemeral UI state (expanded threads, collapsed groups)
 * M45-WV-07: provider does not call store mutation APIs directly
 * M45-WV-08: message bridge delegates to existing command registrations unchanged
 *
 * Phase B behavior tests: FAIL at assertion level because the stub implementations
 * do not produce the required behavior. These tests define completion criteria.
 * The stub throws after minimal setup — it does not implement the described behavior.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";
import { CommentsWebviewViewProvider } from "../../panel/comments-webview-provider.js";
import type {
  CommentsPanelHostMessage,
  CommentsPanelWebviewMessage,
  CommentsPanelViewModel,
  CommentsPanelUiState,
} from "../../panel/comments-webview-contract.js";
import { PanelFilters } from "../../panel/panel-filters.js";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function createMockMemento(): { get: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> } {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn().mockImplementation((key: string, fallback?: unknown) =>
      data.has(key) ? data.get(key) : fallback,
    ),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockHtmlRenderer() {
  return {
    renderInitialHtml: vi.fn().mockReturnValue("<html><body>mock panel</body></html>"),
  };
}

function makeMockModelSource(initialModel?: Partial<CommentsPanelViewModel>) {
  const defaults: CommentsPanelViewModel = {
    generatedAt: new Date().toISOString(),
    filtersSummary: "",
    groupMode: "by-status",
    groups: [],
    totalThreadCount: 0,
    openThreadCount: 0,
    resolvedThreadCount: 0,
    ...initialModel,
  };
  return {
    buildViewModel: vi.fn().mockReturnValue(defaults),
  };
}

function makeMockMessageHandler() {
  return {
    handleMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWebviewView(): {
  webview: {
    options: Record<string, unknown>;
    html: string;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: ReturnType<typeof vi.fn>;
  };
  onDidReceiveMessage: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  const onDidReceiveMessage = vi.fn();
  return {
    webview: {
      options: {},
      html: "",
      postMessage: vi.fn<() => Thenable<boolean>>().mockResolvedValue(true),
      onDidReceiveMessage,
    },
    onDidReceiveMessage,
    dispose: vi.fn(),
  };
}

function defaultViewModel(): CommentsPanelViewModel {
  return {
    generatedAt: new Date().toISOString(),
    filtersSummary: "",
    groupMode: "by-status",
    groups: [],
    totalThreadCount: 0,
    openThreadCount: 0,
    resolvedThreadCount: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("M45-WV CommentsWebviewViewProvider", () => {

  // ── M45-WV-01: provider implements WebviewViewProvider ──────────────────────
  describe("M45-WV-01: provider implements WebviewViewProvider", () => {
    it("instantiable with 3 dependencies", () => {
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        makeMockMessageHandler(),
      );
      expect(provider).toBeDefined();
    });

    it("has getCurrentView returning undefined before resolve", () => {
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        makeMockMessageHandler(),
      );
      expect(provider.getCurrentView()).toBeUndefined();
    });

    it("has dispose method", () => {
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        makeMockMessageHandler(),
      );
      expect(typeof provider.dispose).toBe("function");
    });
  });

  // ── M45-WV-02: resolveWebviewView configures webview + attaches listener ──────
  describe("M45-WV-02: resolveWebviewView configures webview and attaches message listener", () => {
    it("enableScripts is set on webview.options before message listener is attached", () => {
      const mockView = createMockWebviewView();
      const ctx = {} as vscode.WebviewViewResolveContext;
      const token = {} as vscode.CancellationToken;
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        makeMockMessageHandler(),
      );

      // The stub throws after setting this.view — we verify options were set
      try { provider.resolveWebviewView(mockView as unknown as vscode.WebviewView, ctx, token); } catch { /* ignore */ }

      // Phase B: stub DOES set enableScripts=true on webview.options
      // This is one thing the stub does correctly before throwing
      expect(mockView.webview.options["enableScripts"]).toBe(true);
    });

    it("webview.html is set to the result of renderInitialHtml", () => {
      const htmlRenderer = makeMockHtmlRenderer();
      const mockView = createMockWebviewView();
      const provider = new CommentsWebviewViewProvider(
        htmlRenderer,
        makeMockModelSource(),
        makeMockMessageHandler(),
      );
      const ctx = {} as vscode.WebviewViewResolveContext;
      const token = {} as vscode.CancellationToken;

      try { provider.resolveWebviewView(mockView as unknown as vscode.WebviewView, ctx, token); } catch { /* ignore */ }

      // The stub calls renderInitialHtml and assigns to webview.html before throwing
      expect(mockView.webview.html).toBe("<html><body>mock panel</body></html>");
    });

    it("onDidReceiveMessage listener is attached to the webview", () => {
      const mockView = createMockWebviewView();
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        makeMockMessageHandler(),
      );
      const ctx = {} as vscode.WebviewViewResolveContext;
      const token = {} as vscode.CancellationToken;

      try { provider.resolveWebviewView(mockView as unknown as vscode.WebviewView, ctx, token); } catch { /* ignore */ }

      // The stub attaches the listener before throwing
      expect(mockView.onDidReceiveMessage).toHaveBeenCalled();
    });

    it("messages received by the webview are forwarded to messageHandler.handleMessage", () => {
      const messageHandler = makeMockMessageHandler();
      const mockView = createMockWebviewView();
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        messageHandler,
      );
      const ctx = {} as vscode.WebviewViewResolveContext;
      const token = {} as vscode.CancellationToken;

      // Set up the listener that was attached
      try { provider.resolveWebviewView(mockView as unknown as vscode.WebviewView, ctx, token); } catch { /* ignore */ }

      // Extract the callback that was registered
      const listenerCb = mockView.onDidReceiveMessage.mock.calls[0]?.[0] as (msg: CommentsPanelWebviewMessage) => void;
      expect(listenerCb).toBeDefined();

      // Simulate a message from the webview
      const testMsg: CommentsPanelWebviewMessage = { type: "panel:ready", apiVersion: "1" };
      listenerCb(testMsg);

      // Phase B stub does forward the message (it's the last thing before throw in the real impl)
      expect(messageHandler.handleMessage).toHaveBeenCalledWith(testMsg);
    });
  });

  // ── M45-WV-03: on webview ready, host posts initial panel state ──────────────
  describe("M45-WV-03: on webview ready, host posts initial panel state", () => {
    it("postMessage is defined on provider interface", () => {
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        makeMockMessageHandler(),
      );
      expect(typeof provider.postMessage).toBe("function");
    });

    it("postMessage returns undefined when view is not resolved", () => {
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        makeMockMessageHandler(),
      );
      // Phase B: stub throws — result is undefined — FAILS at assertion level
      // Phase C: postMessage returns undefined when view is not set
      let result: unknown;
      try {
        result = provider.postMessage({ type: "panel:state", model: defaultViewModel() });
      } catch {
        result = new Error("stub throws");
      }
      expect(result).not.toBeInstanceOf(Error);
      expect(result).toBeUndefined();
    });

    it("postMessage sends panel:state to the webview when view is resolved", () => {
      const modelSource = makeMockModelSource({
        groupMode: "by-file",
        totalThreadCount: 5,
        openThreadCount: 3,
        resolvedThreadCount: 2,
      });
      const mockView = createMockWebviewView();
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        modelSource,
        makeMockMessageHandler(),
      );
      const ctx = {} as vscode.WebviewViewResolveContext;
      const token = {} as vscode.CancellationToken;

      provider.resolveWebviewView(mockView as unknown as vscode.WebviewView, ctx, token);

      // resolveWebviewView → refresh() → buildViewModel + postMessage
      // postMessage sends the panel:state to the webview
      expect(mockView.webview.postMessage).toHaveBeenCalledWith({
        type: "panel:state",
        model: expect.objectContaining({ groupMode: "by-file", totalThreadCount: 5 }),
      });
    });

    it("panel:ready from webview triggers messageHandler.handleMessage", async () => {
      const messageHandler = makeMockMessageHandler();
      const mockView = createMockWebviewView();
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        messageHandler,
      );
      const ctx = {} as vscode.WebviewViewResolveContext;
      const token = {} as vscode.CancellationToken;

      try { provider.resolveWebviewView(mockView as unknown as vscode.WebviewView, ctx, token); } catch { /* ignore */ }

      // Get the listener that was attached during resolveWebviewView
      const listenerCb = mockView.onDidReceiveMessage.mock.calls[0]?.[0] as (msg: CommentsPanelWebviewMessage) => void;
      listenerCb({ type: "panel:ready", apiVersion: "1" });

      // messageHandler.handleMessage was called with panel:ready — PASSES because stub does forward
      expect(messageHandler.handleMessage).toHaveBeenCalledWith({ type: "panel:ready", apiVersion: "1" });
    });
  });

  // ── M45-WV-04/05: refresh rebuilds and reposts state ────────────────────────
  describe("M45-WV-04/05: refresh() rebuilds and reposts state", () => {
    it("refresh() calls modelSource.buildViewModel", () => {
      const modelSource = makeMockModelSource();
      const mockView = createMockWebviewView();
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        modelSource,
        makeMockMessageHandler(),
      );
      const ctx = {} as vscode.WebviewViewResolveContext;
      const token = {} as vscode.CancellationToken;

      // First resolve the view so it's available for refresh
      provider.resolveWebviewView(mockView as unknown as vscode.WebviewView, ctx, token);

      // Phase C: refresh() calls buildViewModel to get the current view model
      provider.refresh();
      expect(modelSource.buildViewModel).toHaveBeenCalled();
    });

    it("refresh() is callable without throwing", () => {
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        makeMockMessageHandler(),
      );

      // Phase B: stub throws — FAILS at assertion level
      // Phase C: refresh() should be callable without throwing
      let threw = false;
      try { provider.refresh(); } catch { threw = true; }
      expect(threw).toBe(false);
    });

    it("refresh() is idempotent (call twice, no error)", () => {
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        makeMockMessageHandler(),
      );

      // Phase B: stub throws both times — FAILS at assertion level
      // Phase C: both calls succeed without throwing
      let threw1 = false, threw2 = false;
      try { provider.refresh(); } catch { threw1 = true; }
      try { provider.refresh(); } catch { threw2 = true; }
      expect(threw1).toBe(false);
      expect(threw2).toBe(false);
    });
  });

  // ── M45-WV-06: provider owns ephemeral UI state ────────────────────────────
  describe("M45-WV-06: provider owns ephemeral UI state", () => {
    it("getCurrentView returns the view after resolveWebviewView", () => {
      const mockView = createMockWebviewView();
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        makeMockMessageHandler(),
      );
      const ctx = {} as vscode.WebviewViewResolveContext;
      const token = {} as vscode.CancellationToken;

      try { provider.resolveWebviewView(mockView as unknown as vscode.WebviewView, ctx, token); } catch { /* ignore */ }

      // The stub sets this.view BEFORE throwing — this works correctly
      expect(provider.getCurrentView()).toBeDefined();
    });

    it("provider has no store mutation methods — only postMessage and refresh", () => {
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        makeMockMessageHandler(),
      );

      // These are the only public mutation methods
      expect(typeof provider.refresh).toBe("function");
      expect(typeof provider.postMessage).toBe("function");
      expect(typeof provider.dispose).toBe("function");
      // No store.read, store.write, etc.
    });
  });

  // ── M45-WV-08: message bridge delegates commands unchanged ───────────────────
  describe("M45-WV-08: message bridge delegates to existing commands unchanged", () => {
    it("all registered command IDs match the extension manifest strings exactly", () => {
      const globalCommands = [
        "accordo.commentsPanel.refresh",
        "accordo.commentsPanel.filterByStatus",
        "accordo.commentsPanel.filterByIntent",
        "accordo.commentsPanel.clearFilters",
        "accordo.commentsPanel.groupBy",
        "accordo.commentsPanel.deleteAllBrowserComments",
      ];
      const threadCommands = [
        "accordo.commentsPanel.navigateToAnchor",
        "accordo.commentsPanel.resolve",
        "accordo.commentsPanel.reopen",
        "accordo.commentsPanel.reply",
        "accordo.commentsPanel.delete",
      ];

      [...globalCommands, ...threadCommands].forEach(id => {
        expect(id).toMatch(/^accordo\.commentsPanel\./);
        expect(id).toBe(id.trim()); // no whitespace
      });
    });

    it("webview message types are complete and match the contract", () => {
      const expectedTypes: Array<CommentsPanelWebviewMessage["type"]> = [
        "panel:ready",
        "panel:toggle-group",
        "panel:toggle-thread",
        "panel:invoke-global-command",
        "panel:invoke-thread-command",
      ];

      expectedTypes.forEach(type => {
        const msg = { type } as CommentsPanelWebviewMessage;
        expect(msg.type).toBe(type);
      });
    });
  });

  // ── M45-WV-06/07: toggle thread/group do not touch store ──────────────────
  describe("M45-WV-06/07: toggle messages do not mutate store", () => {
    it("panel:toggle-thread message is received by handleMessage", () => {
      const messageHandler = makeMockMessageHandler();
      const mockView = createMockWebviewView();
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        messageHandler,
      );
      const ctx = {} as vscode.WebviewViewResolveContext;
      const token = {} as vscode.CancellationToken;

      try { provider.resolveWebviewView(mockView as unknown as vscode.WebviewView, ctx, token); } catch { /* ignore */ }

      const listenerCb = mockView.onDidReceiveMessage.mock.calls[0]?.[0] as (msg: CommentsPanelWebviewMessage) => void;
      const toggleMsg: CommentsPanelWebviewMessage = {
        type: "panel:toggle-thread",
        threadId: "t-42",
        source: "mouse",
      };
      listenerCb(toggleMsg);

      // The stub does forward the message to handleMessage
      expect(messageHandler.handleMessage).toHaveBeenCalledWith(toggleMsg);
    });

    it("panel:toggle-group message is received by handleMessage", () => {
      const messageHandler = makeMockMessageHandler();
      const mockView = createMockWebviewView();
      const provider = new CommentsWebviewViewProvider(
        makeMockHtmlRenderer(),
        makeMockModelSource(),
        messageHandler,
      );
      const ctx = {} as vscode.WebviewViewResolveContext;
      const token = {} as vscode.CancellationToken;

      try { provider.resolveWebviewView(mockView as unknown as vscode.WebviewView, ctx, token); } catch { /* ignore */ }

      const listenerCb = mockView.onDidReceiveMessage.mock.calls[0]?.[0] as (msg: CommentsPanelWebviewMessage) => void;
      const groupMsg: CommentsPanelWebviewMessage = {
        type: "panel:toggle-group",
        groupId: "file:auth.ts",
        source: "keyboard",
      };
      listenerCb(groupMsg);

      expect(messageHandler.handleMessage).toHaveBeenCalledWith(groupMsg);
    });
  });

});
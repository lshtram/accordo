/**
 * DRW-RT09, DRW-CUI04 — Phase B completion-defining runtime lifecycle tests.
 *
 * These tests exercise the real DrawingEditorProvider pipeline:
 *   DrawingEditorProvider.resolveCustomTextEditor  →  DrawingCommentsBridge  →  WebviewPanel
 *
 * The canonical @accordo/comment-sdk SdkThread shape is:
 *   { id, blockId: string, status: "open"|"resolved", hasUnread: boolean, comments: SdkComment[] }
 *
 * The canonical HostMessage for comments:load is:
 *   { type: "comments:load", threads: SdkThread[] }
 *
 * Proof surfaces: DRW-RT09 (runtime/MCP), DRW-CUI04 (UI/E2E)
 * Requirements: DRW-C05, DRW-C06, DRW-C07, DRW-C08
 *
 * Source: docs/20-requirements/requirements-drawing.md §6.6 (DRW-C05..C08)
 * Source: docs/10-architecture/drawing-architecture.md §9.6..§9.12
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as vscode from "vscode";
import { __testingSeams, activate } from "../../extension.js";
import type { DrawingPanelLike } from "../../core/contracts.js";
import type { SdkThread, SdkComment } from "@accordo/comment-sdk";
import type { SurfaceCommentAdapter } from "@accordo/capabilities";
import { CAPABILITY_COMMANDS } from "@accordo/capabilities";

// ─── Explicit types (avoid esbuild parser issue with ReturnType<typeof>) ────────
type MockPostMessage = ReturnType<typeof vi.fn>;
type MockDisposeFn = ReturnType<typeof vi.fn>;
type WebviewPanelLike = { webview: { postMessage: MockPostMessage; html?: string; options?: Record<string, unknown> }; onDidDispose: MockDisposeFn };
type DisposeFn = { dispose(): void };

// ─── Canonical SdkThread fixture ────────────────────────────────────────────────

function makeSdkThread(id: string, blockId: string, isResolved = false): SdkThread {
  const comment: SdkComment = {
    id: `${id}-c1`,
    author: { kind: "user", name: "Alice" },
    body: "Comment body",
    createdAt: "2026-05-06T10:00:00Z",
  };
  return {
    id,
    blockId,
    status: isResolved ? "resolved" : "open",
    hasUnread: false,
    comments: [comment],
  };
}

// ─── Mock SurfaceCommentAdapter ──────────────────────────────────────────────

/**
 * Test adapter that records calls and exposes fireChange() for test control.
 * The adapter is injected into the provider via DrawingEditorProvider.__testingAdapter.
 *
 * Shape matches SurfaceCommentAdapter from @accordo/capabilities.
 */
function createMockAdapter(threads: SdkThread[]): SurfaceCommentAdapter & { fireChange(uri: string): void } {
  let listener: ((uri: string) => void) | null = null;

  const storeThreads: SdkThread[] = [...threads];

  return {
    createThread: vi.fn(),
    reply: vi.fn(),
    resolve: vi.fn(),
    reopen: vi.fn(),
    delete: vi.fn(),

    getThreadsForUri: vi.fn((_uri: string) =>
      storeThreads.map((t) => ({
        id: t.id,
        // SurfaceCommentAdapter.getThreadsForUri returns CommentThread[], not SdkThread.
        // The bridge is responsible for converting to canonical SdkThread.
        // For test purposes we return a minimal CommentThread shape.
        anchor: {
          kind: "surface" as const,
          uri: `file://${_uri}`,
          surfaceType: "diagram",
          coordinates: { type: "diagram-node" as const, nodeId: t.blockId },
        },
        comments: t.comments.map((c) => ({
          id: c.id,
          author: c.author,
          body: c.body,
          createdAt: c.createdAt,
        })),
        status: t.status === "resolved" ? 1 : 0,
        isCollapsed: false,
      }))
    ),

    onChanged: vi.fn((cb: (uri: string) => void) => {
      listener = cb;
      return { dispose: vi.fn() };
    }),

    // Test-only: allow tests to fire change events
    fireChange(uri: string) {
      if (listener) listener(uri);
    },
  };
}

// ─── MockTextDocument ─────────────────────────────────────────────────────────

class MockTextDocument implements vscode.TextDocument {
  constructor(
    public uri: vscode.Uri,
    private _content: string
  ) {}

  get fileName(): string { return this.uri.fsPath; }
  get isUntitled(): boolean { return false; }
  get languageId(): string { return "markdown"; }
  get isDirty(): boolean { return false; }
  get isClosed(): boolean { return false; }
  get eol(): vscode.EndOfLine { return vscode.EndOfLine.LF; }

  getText(_range?: vscode.Range): string { return this._content; }
  getContent(): string { return this._content; }
}

// ─── Test harness ─────────────────────────────────────────────────────────────

const DrawingEditorProvider = __testingSeams.getDrawingEditorProviderClass();

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "drw-comments-rt-"));
  vi.clearAllMocks();
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: tmpDir, scheme: "file", path: tmpDir } as unknown as vscode.Uri, name: "test", index: 0 }];

  // Clear the static test adapter seam between tests
  (DrawingEditorProvider as unknown as { __testingAdapter?: SurfaceCommentAdapter | null }).__testingAdapter = null;
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── Completion-defining runtime tests ───────────────────────────────────────

describe("comments/runtime-lifecycle", () => {

  // Helper: create a fresh mock webview panel and pass it to resolveCustomTextEditor.
  // Simulates the webview sending scene:ready so that bridge.loadThreadsForUri() fires
  // (the host now defers comments:load until the webview signals it is ready).
  async function openPanel(document: vscode.TextDocument, adapter: SurfaceCommentAdapter | null) {
    if (adapter !== null) {
      (DrawingEditorProvider as unknown as { __testingAdapter: SurfaceCommentAdapter | null }).__testingAdapter = adapter;
    }
    const panelsByPath = new Map<string, DrawingPanelLike>();
    const output = vscode.window.createOutputChannel("test") as unknown as vscode.OutputChannel;
    const provider = new DrawingEditorProvider(panelsByPath, vi.fn(), output, { fsPath: tmpDir, scheme: "file", path: tmpDir } as unknown as vscode.Uri);

    // Call createWebviewPanel FIRST to get a panel with a vi.fn() postMessage
    const panel = vscode.window.createWebviewPanel(
      "accordo.drawing", "Drawing", { viewColumn: 1, preserveFocus: false }, {}
    ) as unknown as WebviewPanelLike;

    await provider.resolveCustomTextEditor(document, panel as unknown as vscode.WebviewPanel);

    // Simulate the webview sending scene:ready — this is what triggers loadThreadsForUri()
    // in the host. Without this, comments:load is never posted (correct new behavior).
    const onDidReceiveMock = panel.webview.onDidReceiveMessage as MockPostMessage;
    const registeredCallback = onDidReceiveMock.mock.calls[0]?.[0] as ((msg: unknown) => void) | undefined;
    if (registeredCallback) {
      registeredCallback({ type: "scene:ready", elementCount: 0, acceptedCount: 0 });
    }

    return { provider, panel };
  }

  it("DRW-RT10/DRW-C09: provider acquires surface adapter command before loading threads", async () => {
    const excalidrawPath = join(tmpDir, "acquire.excalidraw");
    await writeFile(excalidrawPath, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }), "utf8");

    const adapter = createMockAdapter([makeSdkThread("t-acq", "node:A")]);
    vi.mocked(vscode.commands.executeCommand).mockResolvedValueOnce(adapter);
    const document = new MockTextDocument({ fsPath: excalidrawPath, scheme: "file", path: excalidrawPath } as unknown as vscode.Uri, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }));

    await openPanel(document, null);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER);
    expect(adapter.getThreadsForUri).toHaveBeenCalled();

    const commandCall = vi.mocked(vscode.commands.executeCommand).mock.invocationCallOrder[0];
    const getThreadsCall = vi.mocked(adapter.getThreadsForUri).mock.invocationCallOrder[0];
    expect(commandCall).toBeDefined();
    expect(getThreadsCall).toBeDefined();
    expect(commandCall!).toBeLessThan(getThreadsCall!);
  });

  // ─── Requirement DRW-C06: Initial comments:load on panel open ─────────────

  describe("DRW-C06: initial comments:load when panel opens", () => {
    it("loads comment sdk stylesheet from drawing dist/webview artifact path", async () => {
      const excalidrawPath = join(tmpDir, "style.excalidraw");
      await writeFile(excalidrawPath, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }), "utf8");
      const document = new MockTextDocument({ fsPath: excalidrawPath, scheme: "file", path: excalidrawPath } as unknown as vscode.Uri, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }));

      const { panel } = await openPanel(document, null);

      expect(panel.webview.html).toContain("comment-sdk.css");
      expect(panel.webview.html).toContain('<link rel="stylesheet"');
    });

    it("DRW-RT09: resolveCustomTextEditor posts comments:load with node + edge SdkThreads", async () => {
      const mmdPath = join(tmpDir, "flow.mmd");
      const excalidrawPath = join(tmpDir, "flow.excalidraw");
      await writeFile(mmdPath, "flowchart LR\nA-->B\n", "utf8");
      await writeFile(excalidrawPath, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }), "utf8");

      const threads = [
        makeSdkThread("t1", "node:A"),
        makeSdkThread("t2", "edge:A->B"),
      ];
      const adapter = createMockAdapter(threads);
      const document = new MockTextDocument({ fsPath: excalidrawPath, scheme: "file", path: excalidrawPath } as unknown as vscode.Uri, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }));

      const { panel } = await openPanel(document, adapter);

      const postCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const loadCalls = postCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:load");

      // Phase B failure: no comments:load posted (bridge.loadThreadsForUri throws)
      expect(loadCalls.length).toBeGreaterThan(0);

      const [loadMsg] = loadCalls[0]! as [{ type: string; threads: SdkThread[] }];
      expect(loadMsg.type).toBe("comments:load");
      expect(loadMsg.threads).toHaveLength(2);
      expect(loadMsg.threads[0]!.blockId).toBe("node:A");
      expect(loadMsg.threads[1]!.blockId).toBe("edge:A->B");
    });

    it("DRW-RT09: comments:load threads use canonical SdkThread shape (id, blockId, status, hasUnread, comments)", async () => {
      const excalidrawPath = join(tmpDir, "nodes.excalidraw");
      await writeFile(excalidrawPath, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }), "utf8");

      const threads = [makeSdkThread("t-x", "node:X")];
      const adapter = createMockAdapter(threads);
      const document = new MockTextDocument({ fsPath: excalidrawPath, scheme: "file", path: excalidrawPath } as unknown as vscode.Uri, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }));

      const { panel } = await openPanel(document, adapter);

      const postCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const loadCalls = postCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:load");

      expect(loadCalls.length).toBeGreaterThan(0);
      const [loadMsg] = loadCalls[0]! as [{ type: string; threads: SdkThread[] }];

      // Canonical SdkThread has flat shape — no anchor, no context
      for (const thread of loadMsg.threads) {
        expect(thread).toHaveProperty("id");
        expect(thread).toHaveProperty("blockId");
        expect(thread).toHaveProperty("status");
        expect(thread).toHaveProperty("hasUnread");
        expect(thread).toHaveProperty("comments");
        // Must NOT have anchor or context fields
        expect((thread as Record<string, unknown>).anchor).toBeUndefined();
        expect((thread as Record<string, unknown>).context).toBeUndefined();
      }
    });

    it("DRW-RT09: empty adapter (no threads) produces comments:load with empty threads array", async () => {
      const excalidrawPath = join(tmpDir, "empty.excalidraw");
      await writeFile(excalidrawPath, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }), "utf8");

      const adapter = createMockAdapter([]);
      const document = new MockTextDocument({ fsPath: excalidrawPath, scheme: "file", path: excalidrawPath } as unknown as vscode.Uri, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }));

      const { panel } = await openPanel(document, adapter);

      const postCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const loadCalls = postCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:load");

      expect(loadCalls.length).toBeGreaterThan(0);
      const [loadMsg] = loadCalls[0]! as [{ type: string; threads: SdkThread[] }];
      expect(loadMsg.threads).toHaveLength(0);
    });
  });

  // ─── Requirement DRW-C06: Store change refreshes panel ─────────────────────

  describe("DRW-C06: store change refreshes panel without reopen", () => {
    it("DRW-RT09: onChanged fires for open panel URI → second comments:load posted to same webview", async () => {
      const excalidrawPath = join(tmpDir, "refresh.excalidraw");
      await writeFile(excalidrawPath, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }), "utf8");

      const uri = `file://${excalidrawPath}`;
      const threads = [makeSdkThread("t1", "node:A")];
      const adapter = createMockAdapter(threads) as ReturnType<typeof createMockAdapter>;
      const document = new MockTextDocument({ fsPath: excalidrawPath, scheme: "file", path: excalidrawPath } as unknown as vscode.Uri, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }));

      const { panel } = await openPanel(document, adapter);

      // Count posts before fireChange
      const callsBefore = (panel.webview.postMessage as MockPostMessage).mock.calls.length;

      // Simulate store change: adapter.onChanged listener fires
      adapter.fireChange(excalidrawPath);

      const callsAfter = (panel.webview.postMessage as MockPostMessage).mock.calls.length;

      // Phase B failure: onChanged listener not registered → no second posts
      expect(callsAfter).toBeGreaterThan(callsBefore);

      const allCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const loadCalls = allCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:load");
      expect(loadCalls.length).toBeGreaterThan(1);
    });

    it("DRW-RT09: onChanged for different URI does NOT post an extra comments:load", async () => {
      const excalidrawPath = join(tmpDir, "other.excalidraw");
      const otherPath = join(tmpDir, "other2.excalidraw");
      await writeFile(excalidrawPath, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }), "utf8");
      await writeFile(otherPath, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }), "utf8");

      const threads = [makeSdkThread("t1", "node:A")];
      const adapter = createMockAdapter(threads) as ReturnType<typeof createMockAdapter>;
      const document = new MockTextDocument({ fsPath: excalidrawPath, scheme: "file", path: excalidrawPath } as unknown as vscode.Uri, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }));

      const { panel } = await openPanel(document, adapter);

      // ── Prove bridge wiring exists ────────────────────────────────────────────
      // 1. Initial comments:load must be posted (proves loadThreadsForUri was called)
      const initialCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const initialLoadCalls = initialCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:load");
      expect(initialLoadCalls.length).toBeGreaterThan(0); // FAILS at Phase B — bridge not wired

      // 2. Same-URI change must produce a second comments:load (proves listener registered)
      adapter.fireChange(excalidrawPath);
      const afterSameUriCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const loadCallsAfterSame = afterSameUriCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:load");
      expect(loadCallsAfterSame.length).toBeGreaterThan(1); // FAILS at Phase B — listener not wired

      // ── Guard condition: different URI must NOT add another load ──────────────
      // Only reached if wiring is proven. If bridge URI-filter is broken, this fails.
      const callsBeforeDiff = loadCallsAfterSame.length;
      adapter.fireChange(otherPath);

      const allCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const loadCalls = allCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:load");

      // Phase B: if bridge is wired but doesn't filter by URI, this is the guard that catches it
      expect(loadCalls.length).toBe(callsBeforeDiff);
    });

    it("DRW-RT09: onChanged after panel dispose does NOT post to disposed webview", async () => {
      const excalidrawPath = join(tmpDir, "disposed.excalidraw");
      await writeFile(excalidrawPath, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }), "utf8");

      const threads = [makeSdkThread("t1", "node:A")];
      const adapter = createMockAdapter(threads) as ReturnType<typeof createMockAdapter>;
      const document = new MockTextDocument({ fsPath: excalidrawPath, scheme: "file", path: excalidrawPath } as unknown as vscode.Uri, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }));

      const { panel } = await openPanel(document, adapter);

      // ── Prove bridge wiring exists ────────────────────────────────────────────
      // 1. Initial comments:load must be posted
      const initialCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const initialLoadCalls = initialCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:load");
      expect(initialLoadCalls.length).toBeGreaterThan(0); // FAILS at Phase B

      // 2. Same-URI change must produce a second comments:load (proves listener registered)
      adapter.fireChange(excalidrawPath);
      const afterChangeCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const loadCallsAfterChange = afterChangeCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:load");
      expect(loadCallsAfterChange.length).toBeGreaterThan(1); // FAILS at Phase B — listener not wired

      // ── Dispose guard: after panel is closed, same trigger must stop posting ──
      const disposeFn = panel.onDidDispose as MockDisposeFn;
      const disposeCall = disposeFn.mock.calls[0];
      expect(disposeCall).toBeDefined();
      const disposeHandler = disposeCall![0] as () => void;
      disposeHandler(); // Simulate panel disposal

      const callsBefore = loadCallsAfterChange.length;

      // Fire onChanged after dispose — bridge should be dead
      adapter.fireChange(excalidrawPath);

      const callsAfter = (panel.webview.postMessage as MockPostMessage).mock.calls.length;

      // Phase B: if bridge.dispose() is wired to onDidDispose, calls don't increase
      expect(callsAfter).toBe(callsBefore);
    });
  });

  // ─── Requirement DRW-C07: Focus command ───────────────────────────────────

  describe("DRW-C07: accordo_diagram_focusThread registered and opens drawing", () => {
    it("DRW-RT09: accordo_diagram_focusThread is registered on extension activation", () => {
      /**
       * DRW-C07: The drawing extension must register `accordo_diagram_focusThread`
       * so the Comments panel can dispatch to it.
       *
       * Phase B: The command is not yet registered. This test FAILS at assertion level.
       */
      const context = new vscode.ExtensionContext();
      activate(context);

      const focusThreadReg = vi.mocked(vscode.commands.registerCommand).mock.calls.find(
        ([name]: [string]) => name === "accordo_diagram_focusThread"
      );

      expect(focusThreadReg).toBeDefined();
      expect(focusThreadReg![1]).toBeDefined();
    });

    it("DRW-RT09: focusThread command posts comments:focus to panel webview", async () => {
      /**
       * DRW-C07: accordo_diagram_focusThread handler posts canonical comments:focus
       * { type: "comments:focus", threadId: string } to the drawing webview.
       *
       * Phase B: The command is registered but the handler doesn't post comments:focus.
       * This test FAILS at assertion level.
       */
      const excalidrawPath = join(tmpDir, "focus.excalidraw");
      await writeFile(excalidrawPath, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }), "utf8");

      // Activate extension to register commands
      activate(new vscode.ExtensionContext());

      // Register a mock adapter
      const adapter = createMockAdapter([]);
      (DrawingEditorProvider as unknown as { __testingAdapter: SurfaceCommentAdapter | null }).__testingAdapter = adapter;

      // Create provider and panel
      const panelsByPath = new Map<string, DrawingPanelLike>();
      const output = vscode.window.createOutputChannel("test") as unknown as vscode.OutputChannel;
      const provider = new DrawingEditorProvider(panelsByPath, vi.fn(), output, { fsPath: tmpDir, scheme: "file", path: tmpDir } as unknown as vscode.Uri);
      const panel = vscode.window.createWebviewPanel("accordo.drawing", "Drawing", { viewColumn: 1, preserveFocus: false }, {}) as unknown as WebviewPanelLike;
      const document = new MockTextDocument({ fsPath: excalidrawPath, scheme: "file", path: excalidrawPath } as unknown as vscode.Uri, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }));
      await provider.resolveCustomTextEditor(document, panel as unknown as vscode.WebviewPanel);

      // Get the registered focusThread handler
      const focusThreadReg = vi.mocked(vscode.commands.registerCommand).mock.calls.find(
        ([name]: [string]) => name === "accordo_diagram_focusThread"
      );
      expect(focusThreadReg).toBeDefined();

      const focusHandler = focusThreadReg![1] as (threadId: string, mmdUri?: string) => Promise<void>;

      // Simulate calling the handler (as VS Code would when user clicks a thread)
      await focusHandler("thread-abc", `file://${excalidrawPath}`);

      const allCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const focusCalls = allCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:focus");

      // Phase B failure: comments:focus never posted
      expect(focusCalls.length).toBeGreaterThan(0);
      const [focusMsg] = focusCalls[0]! as [{ type: string; threadId: string }];
      expect(focusMsg.threadId).toBe("thread-abc");
    });
  });

  // ─── Requirement DRW-C08: Dispose ─────────────────────────────────────────

  describe("DRW-C08: dispose prevents further store sync to webview", () => {
    it("DRW-RT09: panel onDidDispose triggers bridge.dispose — onChanged after dispose posts nothing", async () => {
      /**
       * DRW-C08: When the custom editor panel is disposed, the comment bridge subscription
       * must be disposed so onChanged events after dispose do not post to the webview.
       *
       * Phase B: bridge.dispose() is not wired to panel onDidDispose.
       * This test FAILS at assertion level because it first proves wiring exists.
       */
      const excalidrawPath = join(tmpDir, "bridge-dispose.excalidraw");
      await writeFile(excalidrawPath, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }), "utf8");

      const threads = [makeSdkThread("t1", "node:A")];
      const adapter = createMockAdapter(threads) as ReturnType<typeof createMockAdapter>;
      const document = new MockTextDocument({ fsPath: excalidrawPath, scheme: "file", path: excalidrawPath } as unknown as vscode.Uri, JSON.stringify({ type: "excalidraw", version: 2, elements: [] }));

      const { panel } = await openPanel(document, adapter);

      // ── Prove bridge wiring exists ────────────────────────────────────────────
      // 1. Initial comments:load must be posted (proves loadThreadsForUri was called)
      const initialCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const initialLoadCalls = initialCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:load");
      expect(initialLoadCalls.length).toBeGreaterThan(0); // FAILS at Phase B

      // 2. Same-URI change must produce a second comments:load (proves listener registered)
      adapter.fireChange(excalidrawPath);
      const afterChangeCalls = (panel.webview.postMessage as MockPostMessage).mock.calls as Array<[unknown]>;
      const loadCallsAfterChange = afterChangeCalls.filter(([msg]) => (msg as { type?: string }).type === "comments:load");
      expect(loadCallsAfterChange.length).toBeGreaterThan(1); // FAILS at Phase B — listener not wired

      // ── Dispose guard ─────────────────────────────────────────────────────────
      const disposeFn = panel.onDidDispose as MockDisposeFn;
      const disposeCall = disposeFn.mock.calls[0];
      expect(disposeCall).toBeDefined();
      const disposeHandler = disposeCall![0] as () => void;
      disposeHandler();

      const callsBefore = loadCallsAfterChange.length;

      // Fire onChanged after dispose — bridge should be dead
      adapter.fireChange(excalidrawPath);

      const callsAfter = (panel.webview.postMessage as MockPostMessage).mock.calls.length;

      // Phase B: if bridge.dispose() is wired to onDidDispose, calls don't increase
      expect(callsAfter).toBe(callsBefore);
    });
  });
});

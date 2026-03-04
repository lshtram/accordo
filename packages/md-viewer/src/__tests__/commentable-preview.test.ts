/**
 * CommentablePreview — tests (Phase B → Phase C)
 *
 * Requirements tested:
 *   M41b-CPE-01  generateNonce() returns a 32-character alphanumeric string
 *   M41b-CPE-02  generateNonce() returns a different value on each call
 *   M41b-CPE-03  mapThemeKind(kind) maps VS Code ColorThemeKind to numeric value
 *   M41b-CPE-04  PREVIEW_VIEW_TYPE is the string "accordo.markdownPreview"
 *   M41b-CPE-05  resolveCustomTextEditor() sets webview.html and creates PreviewBridge
 *   M41b-CPE-06  HTML is rebuilt when the document changes
 *   M41b-CPE-07  subscriptions disposed when panel closes
 *   M41b-CPE-08  webview.options has enableScripts:true and localResourceRoots
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { generateNonce, mapThemeKind, PREVIEW_VIEW_TYPE, CommentablePreview } from "../commentable-preview.js";
import { resetMockState, workspace, mockState } from "./mocks/vscode.js";

// ── Module mocks ──────────────────────────────────────────────────────────────

const { mockRender, mockBuildWebviewHtml, mockLoadThreads, mockBridgeDispose } = vi.hoisted(() => ({
  mockRender: vi.fn().mockResolvedValue({ html: "<p>hello</p>", resolver: {} }),
  mockBuildWebviewHtml: vi.fn().mockReturnValue("<html>mock</html>"),
  mockLoadThreads: vi.fn(),
  mockBridgeDispose: vi.fn(),
}));

vi.mock("../renderer.js", () => ({
  MarkdownRenderer: {
    create: vi.fn().mockResolvedValue({ render: mockRender }),
  },
}));

vi.mock("../webview-template.js", () => ({
  buildWebviewHtml: mockBuildWebviewHtml,
}));

// PreviewBridge mock — track bridge.loadThreadsForUri + bridge.dispose calls
vi.mock("../preview-bridge.js", () => ({
  PreviewBridge: vi.fn().mockImplementation(() => ({
    loadThreadsForUri: mockLoadThreads,
    dispose: mockBridgeDispose,
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockWebviewPanel() {
  const disposeListeners: Array<() => void> = [];
  const msgListeners: Array<(msg: unknown) => void> = [];
  const webview = {
    html: "",
    options: {} as Record<string, unknown>,
    postMessage: vi.fn().mockResolvedValue(true),
    onDidReceiveMessage: vi.fn().mockImplementation((cb: (m: unknown) => void) => {
      msgListeners.push(cb);
      return { dispose: vi.fn() };
    }),
    asWebviewUri: vi.fn().mockImplementation((uri: { fsPath: string }) => ({
      toString: () => `vscode-resource:${uri.fsPath}`,
    })),
  };
  return {
    webview,
    onDidDispose: vi.fn().mockImplementation((cb: () => void) => {
      disposeListeners.push(cb);
      return { dispose: vi.fn() };
    }),
    _fireDispose: () => disposeListeners.forEach((cb) => cb()),
  };
}

function makeMockStore() {
  return {
    onChanged: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    getThreadsForUri: vi.fn().mockReturnValue([]),
    createThread: vi.fn().mockResolvedValue({}),
    reply: vi.fn().mockResolvedValue(undefined),
    resolve: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockDocument(fsPath = "/project/README.md") {
  return {
    uri: {
      fsPath,
      toString: () => `file://${fsPath}`,
    },
    getText: vi.fn().mockReturnValue("# Hello\n"),
  };
}

function makeMockContext() {
  return {
    subscriptions: [] as Array<{ dispose(): void }>,
    extensionUri: { fsPath: "/ext", toString: () => "file:///ext" },
    globalStorageUri: { fsPath: "/tmp/storage" },
    workspaceState: { get: vi.fn(), update: vi.fn() },
  };
}

// ── M41b-CPE-01 / M41b-CPE-02: generateNonce ─────────────────────────────────

describe("generateNonce", () => {
  it("M41b-CPE-01: returns a string of exactly 32 characters", () => {
    const nonce = generateNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce).toHaveLength(32);
  });

  it("M41b-CPE-01: returned string is alphanumeric only [a-zA-Z0-9]", () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[a-zA-Z0-9]{32}$/);
  });

  it("M41b-CPE-02: two successive calls return different values", () => {
    const a = generateNonce();
    const b = generateNonce();
    // Statistically near-impossible to collide, but we allow up to 3 tries
    expect([a === b, generateNonce() === a]).not.toEqual([true, true]);
  });
});

// ── M41b-CPE-03: mapThemeKind ─────────────────────────────────────────────────

describe("mapThemeKind", () => {
  it("M41b-CPE-03: ColorThemeKind.Light (1) maps to 1", () => {
    expect(mapThemeKind(1)).toBe(1);
  });

  it("M41b-CPE-03: ColorThemeKind.Dark (2) maps to 2", () => {
    expect(mapThemeKind(2)).toBe(2);
  });

  it("M41b-CPE-03: ColorThemeKind.HighContrast (3) maps to 3", () => {
    expect(mapThemeKind(3)).toBe(3);
  });

  it("M41b-CPE-03: ColorThemeKind.HighContrastLight (4) maps to 4", () => {
    expect(mapThemeKind(4)).toBe(4);
  });

  it("M41b-CPE-03: unknown kind value returns 2 (fallback Dark)", () => {
    expect(mapThemeKind(0 as never)).toBe(2);
    expect(mapThemeKind(99 as never)).toBe(2);
    expect(mapThemeKind(-1 as never)).toBe(2);
  });
});

// ── M41b-CPE-04: PREVIEW_VIEW_TYPE constant ───────────────────────────────────

describe("PREVIEW_VIEW_TYPE", () => {
  it("M41b-CPE-04: is the string 'accordo.markdownPreview'", () => {
    expect(PREVIEW_VIEW_TYPE).toBe("accordo.markdownPreview");
  });
});

// ── M41b-CPE-05 / 06 / 07 / 08: CommentablePreview class ─────────────────────

describe("CommentablePreview", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
    mockRender.mockResolvedValue({ html: "<p>hello</p>", resolver: {} });
    mockBuildWebviewHtml.mockReturnValue("<html>mock</html>");
    mockLoadThreads.mockReset();
    mockBridgeDispose.mockReset();
  });

  it("M41b-CPE-04: class has a resolveCustomTextEditor method", () => {
    const instance = new CommentablePreview(makeMockContext() as never, makeMockStore() as never);
    expect(typeof instance.resolveCustomTextEditor).toBe("function");
  });

  it("M41b-CPE-05: sets webview.html after initial render", async () => {
    const panel = makeMockWebviewPanel();
    const doc = makeMockDocument();
    const ctx = makeMockContext();
    const store = makeMockStore();

    const cp = new CommentablePreview(ctx as never, store as never);
    await cp.resolveCustomTextEditor(doc as never, panel as never);

    expect(mockRender).toHaveBeenCalled();
    expect(mockBuildWebviewHtml).toHaveBeenCalled();
    expect(panel.webview.html).toBe("<html>mock</html>");
  });

  it("M41b-CPE-05: calls bridge.loadThreadsForUri() after initial render", async () => {
    const panel = makeMockWebviewPanel();
    const cp = new CommentablePreview(makeMockContext() as never, makeMockStore() as never);
    await cp.resolveCustomTextEditor(makeMockDocument() as never, panel as never);

    expect(mockLoadThreads).toHaveBeenCalledOnce();
  });

  it("M41b-CPE-06: re-renders when the document changes", async () => {
    const panel = makeMockWebviewPanel();
    const doc = makeMockDocument("/project/README.md");
    const cp = new CommentablePreview(makeMockContext() as never, makeMockStore() as never);
    await cp.resolveCustomTextEditor(doc as never, panel as never);

    const callsBefore = mockRender.mock.calls.length;

    // Fire a text document change for the same file
    workspace._fireTextDocChange({
      document: { uri: { toString: () => "file:///project/README.md" } },
    });

    // Wait for async re-render
    await new Promise((r) => setTimeout(r, 20));

    expect(mockRender.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("M41b-CPE-06: does NOT re-render for a different document", async () => {
    const panel = makeMockWebviewPanel();
    const doc = makeMockDocument("/project/README.md");
    const cp = new CommentablePreview(makeMockContext() as never, makeMockStore() as never);
    await cp.resolveCustomTextEditor(doc as never, panel as never);

    const callsBefore = mockRender.mock.calls.length;

    workspace._fireTextDocChange({
      document: { uri: { toString: () => "file:///project/OTHER.md" } },
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(mockRender.mock.calls.length).toBe(callsBefore);
  });

  it("M41b-CPE-07: disposes bridge and document listener when panel closes", async () => {
    const panel = makeMockWebviewPanel();
    const cp = new CommentablePreview(makeMockContext() as never, makeMockStore() as never);
    await cp.resolveCustomTextEditor(makeMockDocument() as never, panel as never);

    panel._fireDispose();

    expect(mockBridgeDispose).toHaveBeenCalledOnce();
  });

  it("M41b-CPE-08: webview.options has enableScripts: true", async () => {
    const panel = makeMockWebviewPanel();
    const cp = new CommentablePreview(makeMockContext() as never, makeMockStore() as never);
    await cp.resolveCustomTextEditor(makeMockDocument() as never, panel as never);

    expect(panel.webview.options).toMatchObject({ enableScripts: true });
  });

  it("M41b-CPE-08: webview.options includes localResourceRoots", async () => {
    const panel = makeMockWebviewPanel();
    const ctx = makeMockContext();
    // Simulate a workspace folder
    mockState.workspaceFolders.push({ uri: { fsPath: "/project" }, name: "project", index: 0 });

    const cp = new CommentablePreview(ctx as never, makeMockStore() as never);
    await cp.resolveCustomTextEditor(makeMockDocument() as never, panel as never);

    const opts = panel.webview.options as { localResourceRoots: unknown[] };
    expect(Array.isArray(opts.localResourceRoots)).toBe(true);
    expect(opts.localResourceRoots.length).toBeGreaterThanOrEqual(1);
  });
});

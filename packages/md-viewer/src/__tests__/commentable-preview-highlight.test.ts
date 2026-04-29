/**
 * CommentablePreview highlight lifecycle tests.
 *
 * Requirements tested:
 *   M41b-HLT-03  host maps source lines through the live preview resolver
 *   M41b-HLT-04  active preview highlights replay after webview ready/rerender
 *   M41b-HLT-06  clear by decorationId preserves overlapping active highlights
 *   M41b-HLT-07  clear-all prevents replay after later rerenders
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PreviewHighlightApplyArgs, PreviewHighlightClearArgs } from "@accordo/capabilities";
import { CommentablePreview } from "../commentable-preview.js";
import { resetMockState, workspace } from "./mocks/vscode.js";

const { mockRender, mockBuildWebviewHtml } = vi.hoisted(() => ({
  mockRender: vi.fn(),
  mockBuildWebviewHtml: vi.fn().mockReturnValue("<html>mock</html>"),
}));

vi.mock("../renderer.js", () => ({
  MarkdownRenderer: {
    create: vi.fn().mockResolvedValue({ render: mockRender }),
  },
}));

vi.mock("../webview-template.js", () => ({
  buildWebviewHtml: mockBuildWebviewHtml,
}));

vi.mock("../preview-bridge.js", () => ({
  PreviewBridge: vi.fn().mockImplementation(() => ({
    loadThreadsForUri: vi.fn(),
    dispose: vi.fn(),
  })),
}));

interface PreviewHighlightApi {
  applyHighlight?: (args: PreviewHighlightApplyArgs) => boolean;
  clearHighlight?: (args: PreviewHighlightClearArgs) => boolean;
}

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
    _msgListeners: msgListeners,
  };
  return {
    webview,
    reveal: vi.fn(),
    onDidDispose: vi.fn().mockImplementation((cb: () => void) => {
      disposeListeners.push(cb);
      return { dispose: vi.fn() };
    }),
    _fireDispose: () => disposeListeners.forEach((cb) => cb()),
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

function makeMockDocument(fsPath = "/project/README.md") {
  return {
    uri: { fsPath, toString: () => `file://${fsPath}` },
    getText: vi.fn().mockReturnValue("# Hello\n\nBody\n"),
  };
}

function fireReady(panel: ReturnType<typeof makeMockWebviewPanel>): void {
  panel.webview._msgListeners.forEach((cb) => cb({ type: "webview:ready" }));
}

describe("CommentablePreview highlight replay and clear lifecycle", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
    CommentablePreview.livePanels.clear();
    CommentablePreview.liveResolvers.clear();
    CommentablePreview.pendingRevealLines.clear();
    CommentablePreview.readyUris.clear();
    mockRender.mockResolvedValue({
      html: "<p data-block-id='paragraph-a'>Body</p>",
      resolver: {
        blockIdToLine: vi.fn(),
        lineToBlockId: vi.fn((line: number) => line <= 1 ? "heading-a" : "paragraph-a"),
      },
    });
  });

  it("M41b-HLT-04: replays active preview highlights after markdown rerender", async () => {
    const api = CommentablePreview as unknown as PreviewHighlightApi;
    expect(typeof api.applyHighlight).toBe("function");
    if (!api.applyHighlight) return;

    const panel = makeMockWebviewPanel();
    const document = makeMockDocument();
    const preview = new CommentablePreview(makeMockContext() as never, null);
    await preview.resolveCustomTextEditor(document as never, panel as never);
    fireReady(panel);

    expect(api.applyHighlight({
      uri: "file:///project/README.md",
      decorationId: "accordo-decoration-1",
      startLine: 0,
      endLine: 2,
      color: "rgba(255,255,0,0.3)",
    })).toBe(true);
    const callsBeforeRerender = panel.webview.postMessage.mock.calls.length;

    workspace._fireTextDocChange({ document: { uri: { toString: () => "file:///project/README.md" } } });
    await Promise.resolve();
    await Promise.resolve();

    expect(panel.webview.postMessage.mock.calls.length).toBe(callsBeforeRerender);

    fireReady(panel);

    expect(panel.webview.postMessage.mock.calls.length).toBeGreaterThan(callsBeforeRerender);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "preview:applyHighlight", decorationId: "accordo-decoration-1" }),
    );
  });

  it("M41b-HLT-06: clear by decorationId preserves overlapping active preview highlights", () => {
    const api = CommentablePreview as unknown as PreviewHighlightApi;
    expect(typeof api.applyHighlight).toBe("function");
    expect(typeof api.clearHighlight).toBe("function");
    if (!api.applyHighlight || !api.clearHighlight) return;

    const uri = "file:///project/README.md";
    const panel = makeMockWebviewPanel();
    CommentablePreview.livePanels.set(uri, panel as never);
    CommentablePreview.liveResolvers.set(uri, {
      blockIdToLine: vi.fn(),
      lineToBlockId: vi.fn((line: number) => line === 0 ? "block-a" : "block-b"),
    });
    CommentablePreview.readyUris.add(uri);

    api.applyHighlight({ uri, decorationId: "h1", startLine: 0, endLine: 1, color: "yellow" });
    api.applyHighlight({ uri, decorationId: "h2", startLine: 1, endLine: 1, color: "red" });

    expect(api.clearHighlight({ uri, decorationId: "h1" })).toBe(true);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      type: "preview:clearHighlight",
      decorationId: "h1",
    });
    expect(panel.webview.postMessage).not.toHaveBeenCalledWith({
      type: "preview:clearHighlight",
      decorationId: "h2",
    });
  });

  it("M41b-HLT-07: clear-all removes active preview highlights and prevents replay after rerender", async () => {
    const api = CommentablePreview as unknown as PreviewHighlightApi;
    expect(typeof api.applyHighlight).toBe("function");
    expect(typeof api.clearHighlight).toBe("function");
    if (!api.applyHighlight || !api.clearHighlight) return;

    const panel = makeMockWebviewPanel();
    const document = makeMockDocument();
    const preview = new CommentablePreview(makeMockContext() as never, null);
    await preview.resolveCustomTextEditor(document as never, panel as never);
    fireReady(panel);

    api.applyHighlight({
      uri: "file:///project/README.md",
      decorationId: "h1",
      startLine: 0,
      endLine: 1,
      color: "yellow",
    });
    expect(api.clearHighlight({ uri: "file:///project/README.md" })).toBe(true);
    panel.webview.postMessage.mockClear();

    workspace._fireTextDocChange({ document: { uri: { toString: () => "file:///project/README.md" } } });
    await Promise.resolve();
    await Promise.resolve();
    fireReady(panel);

    expect(panel.webview.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "preview:applyHighlight", decorationId: "h1" }),
    );
  });
});

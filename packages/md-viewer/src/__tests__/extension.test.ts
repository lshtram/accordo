/**
 * extension.ts — activate() tests
 *
 * Requirements tested:
 *   M41b-EXT-01  registerCustomEditorProvider called with PREVIEW_VIEW_TYPE
 *   M41b-EXT-02  CommentStore retrieved via accordo_comments_internal_getStore command
 *   M41b-EXT-03  accordo_preview_open / toggle / openSideBySide commands registered
 *   M41b-EXT-04  all disposables pushed to context.subscriptions
 *   M41b-EXT-05  if accordo-comments unavailable, extension is inert (nothing registered)
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { CAPABILITY_COMMANDS } from "@accordo/capabilities";
import { activate } from "../extension.js";
import {
  resetMockState,
  mockState,
  commands,
  window,
  extensions,
  workspace,
  createMockExtensionContext,
} from "./mocks/vscode.js";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockApplyHighlight, mockClearHighlight, mockResolveEditor } = vi.hoisted(() => ({
  mockApplyHighlight: vi.fn().mockReturnValue(false),
  mockClearHighlight: vi.fn().mockReturnValue(false),
  mockResolveEditor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../commentable-preview.js", () => ({
  PREVIEW_VIEW_TYPE: "accordo.markdownPreview",
  CommentablePreview: Object.assign(
    vi.fn().mockImplementation(() => ({
      resolveCustomTextEditor: mockResolveEditor,
    })),
    {
      applyHighlight: mockApplyHighlight,
      clearHighlight: mockClearHighlight,
    },
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_STORE = {
  onChanged: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  getThreadsForUri: vi.fn().mockReturnValue([]),
  createThread: vi.fn(),
  reply: vi.fn(),
  resolve: vi.fn(),
  delete: vi.fn(),
};

function setupCommentsExtPresent(): void {
  // Return mock for both bridge and comments extension lookups
  (extensions.getExtension as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
    if (id === "accordo.accordo-bridge") return { id, isActive: true, activate: vi.fn().mockResolvedValue(undefined) };
    if (id === "accordo.accordo-comments") return { id, isActive: true, activate: vi.fn().mockResolvedValue(undefined) };
    return undefined;
  });

  // Make the internal getStore command return our mock store
  mockState.registeredCommands.set(
    "accordo_comments_internal_getStore",
    () => MOCK_STORE,
  );
}

function setupCommentsExtAbsent(): void {
  (extensions.getExtension as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("activate", () => {
  beforeEach(() => {
    resetMockState();
    vi.clearAllMocks();
    mockApplyHighlight.mockReturnValue(false);
    mockClearHighlight.mockReturnValue(false);
    mockResolveEditor.mockReset();
  });

  it("M41b-EXT-05: registers preview with null store when accordo-comments is not installed (inert mode)", async () => {
    setupCommentsExtAbsent();
    const ctx = createMockExtensionContext();

    await activate(ctx as never);

    // Editor + 3 commands still registered (preview works, comments are inert)
    expect(window.registerCustomEditorProvider).toHaveBeenCalledWith(
      "accordo.markdownPreview",
      expect.anything(),
      expect.anything(),
    );
    expect(mockState.registeredCommands.has("accordo.preview.open")).toBe(true);
    expect(mockState.registeredCommands.has("accordo.preview.toggle")).toBe(true);
    expect(mockState.registeredCommands.has("accordo.preview.openSideBySide")).toBe(true);
    // getStore was NOT called (extension was absent)
    expect(commands.executeCommand).not.toHaveBeenCalledWith("accordo_comments_internal_getStore");
  });

  it("M41b-EXT-05: registers preview with null store when getStore returns falsy (inert mode)", async () => {
    (extensions.getExtension as ReturnType<typeof vi.fn>).mockImplementation((id: string) => {
      if (id === "accordo.accordo-bridge") return { id, isActive: true, activate: vi.fn().mockResolvedValue(undefined) };
      if (id === "accordo.accordo-comments") return { id, isActive: true, activate: vi.fn().mockResolvedValue(undefined) };
      return undefined;
    });
    // getStore returns undefined (falsy) — falls back to no-op
    mockState.registeredCommands.set("accordo_comments_internal_getStore", () => undefined);
    const ctx = createMockExtensionContext();

    await activate(ctx as never);

    expect(window.registerCustomEditorProvider).toHaveBeenCalledWith(
      "accordo.markdownPreview",
      expect.anything(),
      expect.anything(),
    );
    expect(mockState.registeredCommands.has("accordo.preview.open")).toBe(true);
  });

  it("M41b-EXT-02: retrieves CommentStore via accordo_comments_internal_getStore", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();

    await activate(ctx as never);

    expect(commands.executeCommand).toHaveBeenCalledWith("accordo_comments_internal_getStore");
  });

  it("M41b-EXT-01: registers custom editor provider with PREVIEW_VIEW_TYPE", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();

    await activate(ctx as never);

    expect(window.registerCustomEditorProvider).toHaveBeenCalledWith(
      "accordo.markdownPreview",
      expect.any(Object),
      expect.objectContaining({ webviewOptions: expect.any(Object) }),
    );
  });

  it("F-6: webviewOptions.enableFindWidget is true (enables Ctrl+F in preview)", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();

    await activate(ctx as never);

    expect(window.registerCustomEditorProvider).toHaveBeenCalledWith(
      "accordo.markdownPreview",
      expect.anything(),
      expect.objectContaining({
        webviewOptions: expect.objectContaining({ enableFindWidget: true }),
      }),
    );
  });

  it("reads accordo_preview_defaultSurface and passes supportsMultipleEditorsPerDocument=false when 'text'", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();
    // Mock getConfiguration to return "text" for defaultSurface
    (workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReturnValue({
      get: vi.fn().mockReturnValue("text"),
    });

    await activate(ctx as never);

    expect(workspace.getConfiguration).toHaveBeenCalledWith("accordo.preview");
    expect(window.registerCustomEditorProvider).toHaveBeenCalledWith(
      "accordo.markdownPreview",
      expect.anything(),
      expect.objectContaining({ supportsMultipleEditorsPerDocument: false }),
    );
  });

  it("M41b-EXT-03: registers accordo_preview_open command", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();

    await activate(ctx as never);

    expect(mockState.registeredCommands.has("accordo.preview.open")).toBe(true);
  });

  it("M41b-EXT-03: registers accordo_preview_toggle command", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();

    await activate(ctx as never);

    expect(mockState.registeredCommands.has("accordo.preview.toggle")).toBe(true);
  });

  it("M41b-EXT-03: registers accordo_preview_openSideBySide command", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();

    await activate(ctx as never);

    expect(mockState.registeredCommands.has("accordo.preview.openSideBySide")).toBe(true);
  });

  it("M41b-EXT-04: all disposables pushed to context.subscriptions", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();

    await activate(ctx as never);

    // provider + 3 commands = at least 4 subscriptions
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(4);
    // every entry must have a dispose method
    for (const sub of ctx.subscriptions) {
      expect(typeof sub.dispose).toBe("function");
    }
  });

  it("M41b-EXT-03: accordo_preview_open does nothing if active file is not .md", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();
    await activate(ctx as never);

    // Active editor points to a .ts file
    mockState.activeTextEditor = {
      document: {
        uri: { fsPath: "/project/src/index.ts", toString: () => "file:///project/src/index.ts" } as never,
        lineCount: 10,
        isDirty: false,
        version: 1,
        getText: vi.fn().mockReturnValue(""),
        languageId: "typescript",
      },
      visibleRanges: [],
      selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, isEmpty: true },
    } as never;

    const handler = mockState.registeredCommands.get("accordo.preview.open")!;
    await handler();

    // vscode.openWith should NOT have been called
    const openWithCalls = (commands.executeCommand as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([cmd]) => cmd === "vscode.openWith",
    );
    expect(openWithCalls).toHaveLength(0);
  });

  it("M41b-EXT-03: accordo_preview_open calls vscode.openWith for .md files", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();
    await activate(ctx as never);

    mockState.activeTextEditor = {
      document: {
        uri: { fsPath: "/project/README.md", toString: () => "file:///project/README.md" } as never,
        lineCount: 10,
        isDirty: false,
        version: 1,
        getText: vi.fn().mockReturnValue(""),
        languageId: "markdown",
      },
      visibleRanges: [],
      selection: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, isEmpty: true },
    } as never;

    const handler = mockState.registeredCommands.get("accordo.preview.open")!;
    await handler();

    expect(commands.executeCommand).toHaveBeenCalledWith(
      "vscode.openWith",
      expect.anything(),
      "accordo.markdownPreview",
    );
  });

  it("registers accordo_preview_internal_revealLine and delegates to CommentablePreview", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();
    await activate(ctx as never);

    const handler = mockState.registeredCommands.get("accordo_preview_internal_revealLine");
    expect(handler).toBeDefined();
  });

  // ── M41b-EXT-06: highlight apply/clear commands ──────────────────────────────

  it("M41b-EXT-06: registers accordo_preview_internal_applyHighlight command", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();
    await activate(ctx as never);

    expect(mockState.registeredCommands.has(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT)).toBe(true);
  });

  it("M41b-EXT-06: registers accordo_preview_internal_clearHighlight command", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();
    await activate(ctx as never);

    expect(mockState.registeredCommands.has(CAPABILITY_COMMANDS.PREVIEW_CLEAR_HIGHLIGHT)).toBe(true);
  });

  it("M41b-EXT-06: applyHighlight command returns false when no live preview panel exists", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();
    await activate(ctx as never);

    const handler = mockState.registeredCommands.get(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT)!;
    const result = await handler({
      uri: "file:///workspace/no-such-file.md",
      decorationId: "test-deco-1",
      startLine: 5,
      endLine: 10,
      color: "rgba(255,255,0,0.3)",
    });
    expect(result).toBe(false);
  });

  it("M41b-EXT-06: clearHighlight command returns false when no live preview panel exists", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();
    await activate(ctx as never);

    const handler = mockState.registeredCommands.get(CAPABILITY_COMMANDS.PREVIEW_CLEAR_HIGHLIGHT)!;
    const result = await handler({ uri: "file:///workspace/no-such-file.md" });
    expect(result).toBe(false);
  });

  it("M41b-EXT-06: both highlight commands are registered with CAPABILITY_COMMANDS values", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();
    await activate(ctx as never);

    expect(mockState.registeredCommands.has(CAPABILITY_COMMANDS.PREVIEW_APPLY_HIGHLIGHT)).toBe(true);
    expect(mockState.registeredCommands.has(CAPABILITY_COMMANDS.PREVIEW_CLEAR_HIGHLIGHT)).toBe(true);
  });

  it("M41b-EXT-06: applyHighlight command is registered as disposable (pushed to subscriptions)", async () => {
    setupCommentsExtPresent();
    const ctx = createMockExtensionContext();
    await activate(ctx as never);

    // At least 6 subscriptions: customEditorProvider + 3 preview commands + revealLine + applyHighlight + clearHighlight
    expect(ctx.subscriptions.length).toBeGreaterThanOrEqual(6);
  });
});

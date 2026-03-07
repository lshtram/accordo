/**
 * Tests for NavigationRouter (M45-NR)
 *
 * API checklist:
 * ✓ navigateToThread  — 10 tests (M45-NR-01 → M45-NR-10)
 *
 * Tests use a mock NavigationEnv — no real VS Code API.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { navigateToThread } from "../../panel/navigation-router.js";
import type { NavigationEnv } from "../../panel/navigation-router.js";
import type {
  CommentThread,
  CommentAnchorText,
  CommentAnchorSurface,
} from "@accordo/bridge-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEnv(): NavigationEnv & {
  showTextDocument: ReturnType<typeof vi.fn>;
  executeCommand: ReturnType<typeof vi.fn>;
  showWarningMessage: ReturnType<typeof vi.fn>;
  showInformationMessage: ReturnType<typeof vi.fn>;
  delay: ReturnType<typeof vi.fn>;
} {
  return {
    showTextDocument: vi.fn().mockResolvedValue({}),
    executeCommand: vi.fn().mockResolvedValue(undefined),
    showWarningMessage: vi.fn().mockResolvedValue(undefined),
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockResolvedValue(undefined),
  };
}

function makeThread(anchor: CommentThread["anchor"]): CommentThread {
  return {
    id: "thread-1",
    anchor,
    comments: [{
      id: "c1", threadId: "thread-1",
      createdAt: "2026-03-06T00:00:00Z",
      author: { kind: "user", name: "User" },
      body: "Test", anchor,
      status: "open",
    }],
    status: "open",
    createdAt: "2026-03-06T00:00:00Z",
    lastActivity: "2026-03-06T00:00:00Z",
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("M45-NR NavigationRouter", () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    env = makeEnv();
  });

  it("M45-NR-01: exports navigateToThread as an async function", () => {
    expect(typeof navigateToThread).toBe("function");
  });

  it("M45-NR-02: text anchor → showTextDocument with selection range", async () => {
    const anchor: CommentAnchorText = {
      kind: "text",
      uri: "file:///project/auth.ts",
      range: { startLine: 41, startChar: 0, endLine: 41, endChar: 0 },
      docVersion: 0,
    };
    const thread = makeThread(anchor);
    await navigateToThread(thread, env);

    expect(env.showTextDocument).toHaveBeenCalledTimes(1);
    const [uri, opts] = env.showTextDocument.mock.calls[0];
    expect(uri.toString()).toContain("auth.ts");
    expect(opts.selection).toBeDefined();
    expect(opts.preserveFocus).toBe(false);
    expect(opts.preview).toBe(false);
  });

  it("M45-NR-03: surface/markdown-preview → executeCommand with positional args (uri, threadId, blockId)", async () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/README.md",
      surfaceType: "markdown-preview",
      coordinates: { type: "block", blockId: "heading:2:intro", blockType: "heading" },
    };
    const thread = makeThread(anchor);
    await navigateToThread(thread, env);

    expect(env.executeCommand).toHaveBeenCalledWith(
      "accordo_preview_internal_focusThread",
      "file:///project/README.md",
      "thread-1",
      "heading:2:intro",
    );
  });

  it("M45-NR-04: surface/slide → opens deck then delays then goto slide index", async () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 3, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);
    await navigateToThread(thread, env);

    // Should open presentation first
    expect(env.executeCommand).toHaveBeenCalledWith(
      "accordo_presentation_open",
      expect.anything(), // URI object
    );
    // Should delay for settling
    expect(env.delay).toHaveBeenCalledWith(500);
    // Should goto slide index
    expect(env.executeCommand).toHaveBeenCalledWith(
      "accordo_presentation_goto",
      3,
    );
  });

  it("M45-NR-04: surface/slide → shows info warning if goto command fails and keeps deck open", async () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/deck.md",
      surfaceType: "slide",
      coordinates: { type: "slide", slideIndex: 2, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);

    // Make goto throw (command not found)
    let callCount = 0;
    env.executeCommand.mockImplementation(async (cmd: string) => {
      callCount++;
      if (cmd === "accordo_presentation_goto") throw new Error("command not found");
      return undefined;
    });

    await navigateToThread(thread, env);

    // Should still have called open
    expect(env.executeCommand).toHaveBeenCalledWith(
      "accordo_presentation_open",
      expect.anything(),
    );
    // Should show info message (not warning — the deck is still open)
    expect(env.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Slidev"),
    );
  });

  it("M45-NR-05: surface/browser → executeCommand accordo_browser_focusThread; swallows if not registered", async () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "https://example.com",
      surfaceType: "browser",
      coordinates: { type: "normalized", x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);

    env.executeCommand.mockRejectedValueOnce(new Error("command not found"));

    await navigateToThread(thread, env);

    expect(env.executeCommand).toHaveBeenCalledWith(
      "accordo_browser_focusThread",
      "thread-1",
    );
    expect(env.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Browser"),
    );
  });

  it("M45-NR-06: surface/diagram → executeCommand accordo_diagram_focusThread; graceful fallback", async () => {
    const anchor: CommentAnchorSurface = {
      kind: "surface",
      uri: "file:///project/diagram.tldr",
      surfaceType: "diagram",
      coordinates: { type: "diagram-node", nodeId: "node-42" },
    };
    const thread = makeThread(anchor);

    env.executeCommand.mockRejectedValueOnce(new Error("command not found"));

    await navigateToThread(thread, env);

    expect(env.executeCommand).toHaveBeenCalledWith(
      "accordo_diagram_focusThread",
      "thread-1",
    );
    expect(env.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining("Diagram"),
    );
  });

  it("M45-NR-07: file anchor → showTextDocument without range", async () => {
    const thread = makeThread({ kind: "file", uri: "file:///project/package.json" });
    await navigateToThread(thread, env);

    expect(env.showTextDocument).toHaveBeenCalledTimes(1);
    const [uri, opts] = env.showTextDocument.mock.calls[0];
    expect(uri.toString()).toContain("package.json");
    expect(opts.preserveFocus).toBe(false);
    expect(opts.preview).toBe(false);
    // No selection range for file anchors
    expect(opts.selection).toBeUndefined();
  });

  it("M45-NR-08: unrecognised surfaceType falls back to showTextDocument", async () => {
    const anchor = {
      kind: "surface" as const,
      uri: "file:///project/unknown.xyz",
      surfaceType: "unknown-future-type" as never,
      coordinates: { type: "normalized" as const, x: 0.5, y: 0.5 },
    };
    const thread = makeThread(anchor);
    await navigateToThread(thread, env);

    expect(env.showTextDocument).toHaveBeenCalledTimes(1);
  });

  it("M45-NR-09: navigation errors are caught; shows warning message", async () => {
    const thread = makeThread({
      kind: "text",
      uri: "file:///project/missing.ts",
      range: { startLine: 0, startChar: 0, endLine: 0, endChar: 0 },
      docVersion: 0,
    });

    env.showTextDocument.mockRejectedValueOnce(new Error("file not found"));

    await navigateToThread(thread, env);

    expect(env.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining("Could not navigate"),
    );
  });

  it("M45-NR-10: NavigationEnv interface allows injection of mock for all operations", () => {
    // Type-level test: env satisfies NavigationEnv with all methods present
    const e: NavigationEnv = env;
    expect(typeof e.showTextDocument).toBe("function");
    expect(typeof e.executeCommand).toBe("function");
    expect(typeof e.showWarningMessage).toBe("function");
    expect(typeof e.showInformationMessage).toBe("function");
    expect(typeof e.delay).toBe("function");
  });
});

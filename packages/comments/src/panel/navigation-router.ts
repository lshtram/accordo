/**
 * NavigationRouter — Anchor-aware navigation dispatch for the Comments Panel.
 *
 * Pure async function that routes to the correct VS Code surface for a given
 * CommentThread, dispatching by anchor.kind and surfaceType.
 *
 * Uses injectable NavigationEnv for unit testability without real VS Code APIs.
 * Uses a NavigationAdapterRegistry for surface-type dispatch (§17).
 *
 * Source: requirements-comments-panel.md §3 M45-NR
 */

import * as vscode from "vscode";
import type { CommentThread } from "@accordo/bridge-types";
import {
  CAPABILITY_COMMANDS,
  DEFERRED_COMMANDS,
  createNavigationAdapterRegistry,
} from "@accordo/capabilities";
import type {
  NavigationAdapter,
  NavigationAdapterRegistry,
  NavigationEnv as CapNavigationEnv,
} from "@accordo/capabilities";

// ── NavigationEnv ────────────────────────────────────────────────────────────

/**
 * M45-NR-10: Injectable abstraction over vscode.window, vscode.commands,
 * and delay — allows unit testing without real VS Code.
 */
export interface NavigationEnv {
  showTextDocument(
    uri: vscode.Uri,
    options?: vscode.TextDocumentShowOptions,
  ): Thenable<vscode.TextEditor>;
  executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
  showWarningMessage(message: string): Thenable<string | undefined>;
  showInformationMessage(message: string): Thenable<string | undefined>;
  delay(ms: number): Promise<void>;
  /** Returns the URI strings of all currently visible text editors. */
  visibleTextEditorUris(): readonly string[];
}

// ── Module-level Registry Singleton ──────────────────────────────────────────

/**
 * Singleton registry for NavigationAdapters.
 * Surface packages register adapters at activation time.
 *
 * Adapters currently registered:
 * - browser: calls accordo_browser.focusThread
 *
 * Other surface types (slide, diagram, markdown-preview) are registered by
 * their respective packages and will be handled by Q-3 and Q-5.
 */
const adapterRegistry: NavigationAdapterRegistry = createNavigationAdapterRegistry();

// ── Browser Adapter ──────────────────────────────────────────────────────────

/**
 * NavigationAdapter for the browser surface type.
 * Focuses a comment thread via the accordo_browser.focusThread command.
 */
const browserAdapter: NavigationAdapter = {
  surfaceType: "browser" as const,

  async navigateToAnchor(
    _anchor: Readonly<Record<string, unknown>>,
    _env: CapNavigationEnv,
  ): Promise<boolean> {
    // Browser surfaces don't have a per-anchor concept — navigation is always to the page.
    return true;
  },

  async focusThread(
    threadId: string,
    _anchor: Readonly<Record<string, unknown>>,
    env: CapNavigationEnv,
  ): Promise<boolean> {
    try {
      await env.executeCommand(DEFERRED_COMMANDS.BROWSER_FOCUS_THREAD, threadId);
      return true;
    } catch {
      return false;
    }
  },
};

// ── Preview (Markdown Preview) Adapter ──────────────────────────────────────

/**
 * NavigationAdapter for the markdown-preview surface type.
 * Opens the markdown preview and scrolls to the thread's anchor line.
 */
const previewAdapter: NavigationAdapter = {
  surfaceType: "markdown-preview" as const,

  async navigateToAnchor(
    anchor: Readonly<Record<string, unknown>>,
    _env: CapNavigationEnv,
  ): Promise<boolean> {
    // Navigate to the file that the preview renders.
    const uriStr = anchor.uri as string | undefined;
    if (!uriStr) return false;
    try {
      const doc = await vscode.workspace.openTextDocument(uriStr);
      void doc; // unused — just ensure the file is loaded
      return true;
    } catch {
      return false;
    }
  },

  async focusThread(
    threadId: string,
    anchor: Readonly<Record<string, unknown>>,
    _env: CapNavigationEnv,
  ): Promise<boolean> {
    void threadId;
    try {
      const uriStr = anchor.uri as string | undefined;
      const range = anchor.range as { startLine?: number } | undefined;
      if (!uriStr) return false;

      // Show the markdown preview.
      await vscode.commands.executeCommand("markdown.showPreviewToSide");
      // Small delay to let preview render.
      await new Promise((r) => setTimeout(r, 200));
      // Navigate to the file and line.
      const doc = await vscode.workspace.openTextDocument(uriStr);
      const editor = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Two,
      });
      if (range?.startLine) {
        const pos = new vscode.Position(range.startLine - 1, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.AtTop,
        );
      }
      return true;
    } catch {
      return false;
    }
  },
};

// ── Diagram Adapter ───────────────────────────────────────────────────────────

/**
 * NavigationAdapter for the diagram surface type.
 * Opens the .mmd diagram file and scrolls to the anchor node.
 */
const diagramAdapter: NavigationAdapter = {
  surfaceType: "diagram" as const,

  async navigateToAnchor(
    anchor: Readonly<Record<string, unknown>>,
    _env: CapNavigationEnv,
  ): Promise<boolean> {
    const uriStr = anchor.uri as string | undefined;
    if (!uriStr) return false;
    try {
      const doc = await vscode.workspace.openTextDocument(uriStr);
      void doc;
      return true;
    } catch {
      return false;
    }
  },

  async focusThread(
    threadId: string,
    anchor: Readonly<Record<string, unknown>>,
    _env: CapNavigationEnv,
  ): Promise<boolean> {
    void threadId;
    try {
      const uriStr = anchor.uri as string | undefined;
      if (!uriStr) return false;

      const doc = await vscode.workspace.openTextDocument(uriStr);
      await vscode.window.showTextDocument(doc);
      // If there's a node anchor, try to find and reveal it.
      const anchorKey = anchor.anchorKey as string | undefined;
      if (anchorKey && anchorKey !== "body:center") {
        await vscode.commands.executeCommand("editor.action.revealDefinition");
      }
      return true;
    } catch {
      return false;
    }
  },
};

// Register the browser adapter at module load time.
// Other adapters (slide, diagram, markdown-preview) are registered by their
// respective surface packages when they activate.
adapterRegistry.register(browserAdapter);

// Register the preview and diagram adapters.
adapterRegistry.register(previewAdapter);
adapterRegistry.register(diagramAdapter);

// ── navigateToThread ─────────────────────────────────────────────────────────

/**
 * M45-NR-01: Routes to the correct VS Code surface based on anchor kind and type.
 *
 * Routing table:
 * - text         → showTextDocument with selection range
 * - surface/markdown-preview → executeCommand('accordo_preview_internal_focusThread', uri, threadId, blockId)
 * - surface/slide → open deck → delay → goto slide index (graceful fallback)
 * - surface/browser → registry.focusThread (primary); falls back to DEFERRED_COMMANDS on failure
 * - surface/diagram → executeCommand('accordo_diagram_focusThread', threadId) (graceful)
 * - file         → showTextDocument without range
 * - unknown      → fallback to showTextDocument(uri)
 *
 * Error contract: never throws. On failure shows warningMessage.
 */
export async function navigateToThread(
  thread: CommentThread,
  env: NavigationEnv,
  registry?: NavigationAdapterRegistry,
): Promise<void> {
  // Use the passed registry if provided, otherwise fall back to the module-level singleton.
  // This allows tests to inject a mock registry while production code uses the singleton.
  const activeRegistry = registry ?? adapterRegistry;

  try {
    const anchor = thread.anchor;

    if (anchor.kind === "text") {
      const { Uri, Range } = await import("vscode");
      const uri = Uri.parse(anchor.uri);
      const range = new Range(anchor.range.startLine, 0, anchor.range.endLine, 0);

      // For .md files: respect whichever view is already open for this file.
      if (anchor.uri.toLowerCase().endsWith(".md")) {
        // If the file is already visible in a text editor, navigate there — never
        // force-open the preview over an explicitly chosen text editor view.
        const textEditorOpen = env.visibleTextEditorUris().includes(anchor.uri);
        if (!textEditorOpen) {
          try {
            // Fast path: Accordo preview already open — scroll to the comment.
            // accordo_preview_internal_focusThread returns true when a live panel
            // was found, false when not.
            const found = await env.executeCommand(
              CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD, anchor.uri, thread.id, undefined,
            );
            if (found) return;
            // Preview not open — open it.
          } catch {
            // Command unavailable — fall through to openWith.
          }
          try {
            await env.executeCommand("vscode.openWith", uri, "accordo.markdownPreview");
          } catch {
            // vscode.openWith not available — fall through to text editor.
          }
          await env.delay(400);
          try {
            await env.executeCommand(CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD, anchor.uri, thread.id, undefined);
            return;
          } catch {
            // Preview still not available — fall through to text editor.
          }
        }
      }

      const editor = await env.showTextDocument(uri, { selection: range, preserveFocus: false, preview: false });
      // Center the annotated line in the viewport (2 = TextEditorRevealType.InCenter).
      editor.revealRange(range, 2);
      // Expand the gutter comment thread widget so the inline view is open.
      try {
        await env.executeCommand(CAPABILITY_COMMANDS.COMMENTS_EXPAND_THREAD, thread.id);
      } catch {
        // Non-critical — widget may already be visible.
      }
      return;
    }

    if (anchor.kind === "surface") {
      const { surfaceType, uri: uriStr } = anchor;

      if (surfaceType === "markdown-preview") {
        const coords = anchor.coordinates;
        const blockId = (coords as { blockId?: string }).blockId;
        await env.executeCommand(CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD, uriStr, thread.id, blockId);
        return;
      }

      if (surfaceType === "slide") {
        const { Uri } = await import("vscode");
        const uri = Uri.parse(uriStr);
        const coords = anchor.coordinates as { slideIndex: number };

        // Try registry-based navigation first (primary path)
        // Calls navigateToAnchor THEN focusThread — both must succeed for a clean return.
        const slideAdapter = activeRegistry.get("slide");
        if (slideAdapter) {
          try {
            const navResult = await slideAdapter.navigateToAnchor(
              anchor as unknown as Readonly<Record<string, unknown>>,
              env as unknown as CapNavigationEnv,
            );
            if (!navResult) throw new Error("navigateToAnchor returned false");
            // Slide navigated — now focus the thread.
            await slideAdapter.focusThread(
              thread.id,
              anchor as unknown as Readonly<Record<string, unknown>>,
              env as unknown as CapNavigationEnv,
            );
            return;
          } catch { /* fall through to deferred path */ }
        }

        // Deferred path: use DEFERRED_COMMANDS directly
        // Fast path: deck already running — goto immediately, no delay needed.
        // accordo_presentation_internal_goto throws on error (no UI), unlike the
        // user-facing accordo.presentation.goto which swallows errors to showErrorMessage.
        try {
          await env.executeCommand(DEFERRED_COMMANDS.PRESENTATION_GOTO, coords.slideIndex);
          // Focus the comment thread in the presentation webview.
          try {
            await env.executeCommand(DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD, thread.id);
          } catch { /* non-critical */ }
          return;
        } catch {
          // Deck not running — open it and wait for startup.
        }
        await env.executeCommand("accordo.presentation.open", uri);
        await env.delay(2000);
        try {
          await env.executeCommand(DEFERRED_COMMANDS.PRESENTATION_GOTO, coords.slideIndex);
          try {
            await env.executeCommand(DEFERRED_COMMANDS.PRESENTATION_FOCUS_THREAD, thread.id);
          } catch { /* non-critical */ }
        } catch {
          await env.showInformationMessage(
            "Marp deck opened. Slide navigation unavailable — try again in a moment.",
          );
        }
        return;
      }

      if (surfaceType === "browser") {
        // Registry-first dispatch: use the browser adapter if registered.
        const browserAdapterInstance = activeRegistry.get("browser");
        if (browserAdapterInstance) {
          try {
            const success = await browserAdapterInstance.focusThread(
              thread.id,
              anchor as unknown as Readonly<Record<string, unknown>>,
              env as unknown as CapNavigationEnv,
            );
            if (!success) {
              await env.showInformationMessage("Browser extension not connected.");
            }
          } catch {
            await env.showInformationMessage("Browser extension not connected.");
          }
          return;
        }

        // Fallback (should not occur since browser adapter is registered at module load,
        // but preserved for belt-and-suspenders safety):
        try {
          await env.executeCommand(DEFERRED_COMMANDS.BROWSER_FOCUS_THREAD, thread.id);
        } catch {
          await env.showInformationMessage("Browser extension not connected.");
        }
        return;
      }

      if (surfaceType === "diagram") {
        try {
          // Pass the mmd file URI so the command can open the panel if it is not
          // already showing — mirrors the slidev open-then-navigate pattern.
          await env.executeCommand(CAPABILITY_COMMANDS.DIAGRAM_FOCUS_THREAD, thread.id, uriStr);
        } catch {
          await env.showInformationMessage("Diagram extension not connected.");
        }
        return;
      }

      // Unknown surface type — fall back to opening the file
      const { Uri } = await import("vscode");
      await env.showTextDocument(Uri.parse(uriStr), { preserveFocus: false, preview: false });
      return;
    }

    if (anchor.kind === "file") {
      const { Uri } = await import("vscode");
      await env.showTextDocument(Uri.parse(anchor.uri), { preserveFocus: false, preview: false });
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await env.showWarningMessage(`Could not navigate to thread: ${msg}`);
  }
}

// ── Registry Access (for testing) ────────────────────────────────────────────

/**
 * Returns the module-level NavigationAdapterRegistry singleton.
 * Exported for use in tests that need to inspect or manipulate registered adapters.
 */
export function getAdapterRegistry(): NavigationAdapterRegistry {
  return adapterRegistry;
}

/**
 * NavigationRouter — Anchor-aware navigation dispatch for the Comments Panel.
 *
 * Pure async function that routes to the correct VS Code surface for a given
 * CommentThread, dispatching by anchor.kind and surfaceType.
 *
 * Uses injectable NavigationEnv for unit testability without real VS Code APIs.
 *
 * Source: requirements-comments-panel.md §3 M45-NR
 */

import type * as vscode from "vscode";
import type { CommentThread } from "@accordo/bridge-types";

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

// ── navigateToThread ─────────────────────────────────────────────────────────

/**
 * M45-NR-01: Routes to the correct VS Code surface based on anchor kind and type.
 *
 * Routing table:
 * - text         → showTextDocument with selection range
 * - surface/markdown-preview → executeCommand('accordo_preview_internal_focusThread', uri, threadId, blockId)
 * - surface/slide → open deck → delay → goto slide index (graceful fallback)
 * - surface/browser → executeCommand('accordo_browser_focusThread', threadId) (graceful)
 * - surface/diagram → executeCommand('accordo_diagram_focusThread', threadId) (graceful)
 * - file         → showTextDocument without range
 * - unknown      → fallback to showTextDocument(uri)
 *
 * Error contract: never throws. On failure shows warningMessage.
 */
export async function navigateToThread(
  thread: CommentThread,
  env: NavigationEnv,
): Promise<void> {
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
              "accordo_preview_internal_focusThread", anchor.uri, thread.id, undefined,
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
            await env.executeCommand("accordo_preview_internal_focusThread", anchor.uri, thread.id, undefined);
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
        await env.executeCommand("accordo_comments_internal_expandThread", thread.id);
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
        await env.executeCommand("accordo_preview_internal_focusThread", uriStr, thread.id, blockId);
        return;
      }

      if (surfaceType === "slide") {
        const { Uri } = await import("vscode");
        const uri = Uri.parse(uriStr);
        const coords = anchor.coordinates as { slideIndex: number };

        // Fast path: deck already running — goto immediately, no delay needed.
        // accordo_presentation_internal_goto throws on error (no UI), unlike the
        // user-facing accordo.presentation.goto which swallows errors to showErrorMessage.
        try {
          await env.executeCommand("accordo_presentation_internal_goto", coords.slideIndex);
          // Focus the comment thread in the presentation webview.
          try {
            await env.executeCommand("accordo_presentation_internal_focusThread", thread.id);
          } catch { /* non-critical */ }
          return;
        } catch {
          // Deck not running — open it and wait for startup.
        }
        await env.executeCommand("accordo.presentation.open", uri);
        await env.delay(2000);
        try {
          await env.executeCommand("accordo_presentation_internal_goto", coords.slideIndex);
          try {
            await env.executeCommand("accordo_presentation_internal_focusThread", thread.id);
          } catch { /* non-critical */ }
        } catch {
          await env.showInformationMessage(
            "Slidev deck opened. Slide navigation unavailable — install the Accordo Slidev extension.",
          );
        }
        return;
      }

      if (surfaceType === "browser") {
        try {
          await env.executeCommand("accordo_browser_focusThread", thread.id);
        } catch {
          await env.showInformationMessage("Browser extension not connected.");
        }
        return;
      }

      if (surfaceType === "diagram") {
        try {
          // Pass the mmd file URI so the command can open the panel if it is not
          // already showing — mirrors the slidev open-then-navigate pattern.
          await env.executeCommand("accordo_diagram_focusThread", thread.id, uriStr);
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

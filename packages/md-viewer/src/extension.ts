/**
 * accordo-md-viewer — VS Code Extension Entry Point
 *
 * Activates by acquiring CommentStore from accordo-comments and wiring:
 * - CommentablePreview (CustomTextEditorProvider)
 * - Preview commands (open, toggle, openSideBySide)
 *
 * If accordo-comments is not installed the extension logs a warning and is
 * inert — the preview still renders markdown but comment features are disabled.
 *
 * Source: requirements-md-viewer.md M41b-EXT
 *
 * Requirements:
 *   M41b-EXT-01  registerCustomEditorProvider(PREVIEW_VIEW_TYPE, ...)
 *   M41b-EXT-02  retrieve CommentStore via accordo.comments.internal.getStore
 *   M41b-EXT-03  register accordo.preview.open / toggle / openSideBySide commands
 *   M41b-EXT-04  all disposables pushed to context.subscriptions
 *   M41b-EXT-05  if accordo-comments unavailable, preview is inert (no comment bridge)
 */

import * as vscode from "vscode";
import type { CommentStoreLike } from "./preview-bridge.js";
import { CommentablePreview, PREVIEW_VIEW_TYPE } from "./commentable-preview.js";

// ── activate ──────────────────────────────────────────────────────────────────

/**
 * Called by VS Code when the extension activates (onStartupFinished).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Ensure Bridge activates first — Comments depends on it for tools/state
  const bridgeExt = vscode.extensions.getExtension("accordo.accordo-bridge");
  if (bridgeExt && !bridgeExt.isActive) {
    try { await bridgeExt.activate(); } catch { /* bridge may legitimately fail in EDH */ }
  }

  // M41b-EXT-05: guard — log warning if accordo-comments is absent
  const commentsExt = vscode.extensions.getExtension("accordo.accordo-comments");
  if (!commentsExt) {
    console.warn("[accordo-md-viewer] accordo-comments is not installed — comment features disabled");
  }

  // M41b-EXT-02: retrieve CommentStore via internal command; null when absent
  let store: CommentStoreLike | null = null;
  if (commentsExt) {
    try {
      // Ensure the comments extension has actually activated before calling its command
      if (!commentsExt.isActive) {
        await commentsExt.activate();
      }
      const acquired = (await vscode.commands.executeCommand(
        "accordo.comments.internal.getStore",
      )) as CommentStoreLike | undefined;
      if (acquired && typeof acquired.createThread === "function") {
        store = acquired;
      }
    } catch (err) {
      // Could not retrieve CommentStore — comment features disabled
    }
  }

  // Read defaultSurface configuration setting — controls whether .md files open
  // in the Accordo preview by default ("viewer") or in VS Code's text editor ("text").
  const defaultSurface = vscode.workspace
    .getConfiguration("accordo.preview")
    .get<string>("defaultSurface", "viewer");

  const preview = new CommentablePreview(context, store);

  // M41b-EXT-01: register custom editor provider (M41b-EXT-04: push to subscriptions)
  // When defaultSurface is "text", register with supportsMultipleEditorsPerDocument
  // so VS Code does not auto-open .md files in the preview.
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(PREVIEW_VIEW_TYPE, preview, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: defaultSurface !== "text",
    }),
  );

  // M41b-EXT-03: register the three preview commands
  context.subscriptions.push(
    vscode.commands.registerCommand("accordo.preview.open", async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri?.fsPath.endsWith(".md")) return;
      await vscode.commands.executeCommand("vscode.openWith", uri, PREVIEW_VIEW_TYPE);
    }),

    vscode.commands.registerCommand("accordo.preview.toggle", async () => {
      // If there is an active .md text editor — switch to preview
      const textEditor = vscode.window.activeTextEditor;
      if (textEditor?.document.uri.fsPath.endsWith(".md")) {
        await vscode.commands.executeCommand("vscode.openWith", textEditor.document.uri, PREVIEW_VIEW_TYPE);
        return;
      }
      // Otherwise assume we are in the preview — open the file in the default text editor
      const tabInput = vscode.window.tabGroups?.activeTabGroup?.activeTab?.input as
        | { uri?: import("vscode").Uri }
        | undefined;
      const fileUri = tabInput?.uri;
      if (fileUri?.fsPath.endsWith(".md")) {
        await vscode.window.showTextDocument(fileUri);
      }
    }),

    vscode.commands.registerCommand("accordo.preview.openSideBySide", async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri?.fsPath.endsWith(".md")) return;
      await vscode.commands.executeCommand(
        "vscode.openWith",
        uri,
        PREVIEW_VIEW_TYPE,
        vscode.ViewColumn.Beside,
      );
    }),

    // Internal command — called by accordo-comments focusInPreview handler.
    // Finds the live webview panel for the given URI and sends a comments:focus message.
    vscode.commands.registerCommand(
      "accordo.preview.internal.focusThread",
      (uri: string, threadId: string, blockId?: string) => {
        const panel = CommentablePreview.livePanels.get(uri);
        if (panel) {
          panel.reveal(undefined, false);
          void panel.webview.postMessage({ type: "comments:focus", threadId, blockId });
        }
      },
    ),
  );
}

// ── deactivate ────────────────────────────────────────────────────────────────

export function deactivate(): void {}

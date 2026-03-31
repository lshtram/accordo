/**
 * A15 — panel-commands: webview setup helpers for DiagramPanel factories.
 *
 * Contains setupWebview() — the common webview wiring used by create(),
 * createEmpty(), and createFromExistingPanel().
 *
 * Source: diag_workplan.md §4.15
 */

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { getWebviewHtml } from "./html.js";
import { cleanupOnDispose } from "./panel-state.js";
import { loadAndPost, handleWebviewMessage } from "./panel-core.js";
import type { PanelState } from "./panel-state.js";
import type { WebviewToHostMessage } from "./protocol.js";

// ── setupWebview ──────────────────────────────────────────────────────────────

/**
 * Common webview setup for all DiagramPanel factory methods.
 *
 * Registers:
 *  - webview message listener → handleWebviewMessage
 *  - panel onDidDispose handler → cleanupOnDispose
 *  - file-system watcher with 500 ms debounce → refresh
 *
 * Sets webview.html via getWebviewHtml() with a fresh nonce.
 */
export function setupWebview(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  mmdPath: string,
  state: PanelState,
): void {
  // Message listener: register BEFORE setting html so canvas:ready is never missed.
  // Create the extended state ONCE and reuse it so _currentLayout mutations from
  // loadAndPost persist across subsequent messages (canvas:node-moved, etc.).
  const extState = state as PanelState & {
    _panel: vscode.WebviewPanel;
    _log?: (m: string) => void;
    _createTime?: number;
  };
  extState._panel = panel;
  state._disposables.push(
    panel.webview.onDidReceiveMessage((msg: unknown) => {
      handleWebviewMessage(
        extState,
        msg as WebviewToHostMessage,
      );
    }),
  );

  // Dispose handler: clean up all resources when panel is closed.
  state._disposables.push(
    panel.onDidDispose(() => {
      cleanupOnDispose(state);
    }),
  );

  // File-system watcher with 500 ms debounce for auto-refresh on save.
  if (mmdPath !== "") {
    const watcher = vscode.workspace.createFileSystemWatcher(mmdPath);
    state._disposables.push(
      watcher.onDidChange(() => {
        if (state._refreshTimer !== null) clearTimeout(state._refreshTimer);
        state._refreshTimer = setTimeout(() => {
          state._refreshTimer = null;
          const extState = state as PanelState & { _panel: vscode.WebviewPanel };
          loadAndPost({ ...extState, _panel: panel }).catch(() => {
            // Errors shown via host:error-overlay inside loadAndPost.
          });
        }, 500);
      }),
    );
    state._disposables.push(watcher);
  }

  // Build and assign the webview HTML.
  const nonce = randomBytes(16).toString("hex");
  const bundleUri = panel.webview
    .asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "webview.bundle.js"),
    )
    .toString();
  const virgilFontUri = panel.webview
    .asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "Virgil.woff2"),
    )
    .toString();
  const excalidrawAssetsUri = panel.webview
    .asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "dist", "webview"))
    .toString();
  const sdkCssUri = panel.webview
    .asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "sdk.css"),
    )
    .toString();

  panel.webview.html = getWebviewHtml({
    nonce,
    cspSource: panel.webview.cspSource,
    bundleUri,
    virgilFontUri,
    excalidrawAssetsUri,
    sdkCssUri,
  });
}

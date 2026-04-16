/**
 * Diagram Modularity — Webview setup and disposable registration.
 *
 * Wires the webview HTML, message listener, dispose handler, and
 * file-system watcher for auto-refresh.
 *
 * Layer: L4 (host/) — may import vscode, L0..L3.
 * Source: docs/reviews/diagram-modularity-A.md §panel-setup.ts
 */

import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { HostContext } from "./host-context.js";
import { getWebviewHtml } from "../webview/html.js";
import { routeWebviewMessage } from "./panel-message-router.js";
import { cleanupOnDispose } from "./panel-state.js";
import type { WebviewToHostMessage } from "../webview/protocol.js";

// ── setupWebview ─────────────────────────────────────────────────────────────

/**
 * Common webview setup for all DiagramPanel factory methods.
 *
 * Registers:
 *   - webview message listener -> routeWebviewMessage
 *   - panel onDidDispose handler -> cleanupOnDispose
 *   - file-system watcher with 500ms debounce -> loadAndPost
 *
 * Sets webview.html via getWebviewHtml() with a fresh nonce.
 *
 * @param ctx          - Host context.
 * @param extensionUri - The extension's base URI for resolving webview resources.
 */
export function setupWebview(
  ctx: HostContext,
  extensionUri: vscode.Uri,
): void {
  // Set webview HTML with a fresh nonce.
  const nonce = randomBytes(16).toString("hex");
  const bundleUri = ctx.panel.webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "webview.bundle.js"))
    .toString();
  const virgilFontUri = ctx.panel.webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "Virgil.woff2"))
    .toString();
  const excalidrawAssetsUri = ctx.panel.webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview"))
    .toString();
  const sdkCssUri = ctx.panel.webview
    .asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview", "sdk.css"))
    .toString();
  const mermaidLibraryUri = ctx.panel.webview
    .asWebviewUri(
      vscode.Uri.joinPath(
        extensionUri,
        "dist",
        "webview",
        "excalidraw",
        "accordo-mermaid-shapes.excalidrawlib",
      ),
    )
    .toString();

  ctx.panel.webview.html = getWebviewHtml({
    nonce,
    cspSource: ctx.panel.webview.cspSource,
    bundleUri,
    virgilFontUri,
    excalidrawAssetsUri,
    sdkCssUri,
    mermaidLibraryUri,
  });

  // Register message listener.
  const msgDisposable = ctx.panel.webview.onDidReceiveMessage((msg: unknown) => {
    routeWebviewMessage(ctx, msg as WebviewToHostMessage);
  });
  ctx.state._disposables.push(msgDisposable);

  // Register dispose handler.
  const disposeDisposable = ctx.panel.onDidDispose(() => {
    cleanupOnDispose(ctx.state);
  });
  ctx.state._disposables.push(disposeDisposable);

  // Register file-system watcher with 500ms debounce for auto-refresh.
  if (ctx.state.mmdPath !== "") {
    const watcher = vscode.workspace.createFileSystemWatcher(ctx.state.mmdPath);
    ctx.state._disposables.push(watcher);
    // Set _refreshTimer synchronously so callers can observe watcher registration.
    // It will be overwritten when the debounce fires.
    ctx.state._refreshTimer = setTimeout(() => {
      ctx.state._refreshTimer = null;
      // Dynamically import to avoid circular dependency.
      void import("./panel-scene-loader.js").then(({ loadAndPost }) => {
        void loadAndPost(ctx).catch(() => {
          // Errors shown via host:error-overlay inside loadAndPost.
        });
      });
    }, 500);
    watcher.onDidChange(() => {
      if (ctx.state._refreshTimer !== null) clearTimeout(ctx.state._refreshTimer);
      ctx.state._refreshTimer = setTimeout(() => {
        ctx.state._refreshTimer = null;
        void import("./panel-scene-loader.js").then(({ loadAndPost }) => {
          void loadAndPost(ctx).catch(() => {
            // Errors shown via host:error-overlay inside loadAndPost.
          });
        });
      }, 500);
    });
  }
}

// ── registerDisposables ──────────────────────────────────────────────────────

/**
 * Register panel and extension-level disposables so the panel cleans up
 * when closed or the extension deactivates.
 *
 * @param ctx              - Host context.
 * @param panel            - The webview panel to register dispose handlers on.
 * @param extensionContext - The VS Code extension context for subscription tracking.
 */
export function registerDisposables(
  ctx: HostContext,
  panel: vscode.WebviewPanel,
  _extensionContext: vscode.ExtensionContext,
): void {
  // Register the panel's onDidDispose to trigger state cleanup.
  if (typeof panel.onDidDispose === "function") {
    const disposeDisposable = panel.onDidDispose(() => {
      cleanupOnDispose(ctx.state);
    });
    ctx.state._disposables.push(disposeDisposable);
  }
}

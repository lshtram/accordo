/**
 * accordo-comments — Panel Bootstrap
 *
 * Wires the custom Comments Panel (M45-EXT):
 *   - WebviewView-based Comments Panel (M45-WV)
 *   - Panel view registration (accordo-comments-panel)
 *   - Panel commands (via registerPanelCommands)
 *   - accordo.comments.new command (gutter input box / reply)
 *   - workspace.onDidChangeTextDocument for staleness tracking
 *
 * Source: comments-architecture.md §10 (panel section)
 */

import * as vscode from "vscode";
import type { CommentStore } from "./comment-store.js";
import type { NativeComments } from "./native-comments.js";
import { PanelFilters } from "./panel/panel-filters.js";
import { CommentsTreeProvider } from "./panel/comments-tree-provider.js";
import { registerPanelCommands } from "./panel/panel-commands.js";
import type { PanelPresentationSurface } from "./panel/panel-commands.js";
import type { NavigationEnv } from "./panel/navigation-router.js";
import { buildCommentsPanelViewModel, type CommentsPanelProjectionStore } from "./panel/comments-projection-builder.js";
import { CommentsWebviewViewProvider } from "./panel/comments-webview-provider.js";
import { RuntimeMessageHandler } from "./panel/comments-message-handler.js";
import type { CommentsPanelUiState } from "./panel/comments-webview-contract.js";

// ── HTML Renderer ───────────────────────────────────────────────────────────────

class WebviewPanelHtmlRenderer {
  renderInitialHtml(webview: vscode.Webview): string {
    const nonce = Array.from({ length: 16 }, () => Math.random().toString(36).at(-1) ?? "").join("");
    const csp = [
      "default-src 'none'",
      "script-src 'nonce-${nonce}'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "connect-src 'self'",
    ]
      .map((d) => d.replace("\${nonce}", nonce))
      .join("; ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Comments</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family, system-ui); font-size: var(--vscode-font-size, 13px); background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-foreground, #cccccc); height: 100vh; display: flex; flex-direction: column; }
    #panel { flex: 1; overflow-y: auto; padding: 8px; }
    .empty { color: var(--vscode-disabledForeground, #888); text-align: center; padding: 32px 16px; font-style: italic; }
    .group-header { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-disabledForeground, #888); padding: 8px 4px 4px; cursor: pointer; user-select: none; }
    .group-header::before { content: "▸ "; transition: transform 0.1s; }
    .group-header.expanded::before { content: "▾ "; }
    .thread { display: flex; align-items: flex-start; gap: 6px; padding: 6px 4px; cursor: pointer; border-radius: 3px; }
    .thread:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
    .thread-meta { flex: 1; min-width: 0; }
    .thread-title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .thread-subtitle { font-size: 11px; color: var(--vscode-disabledForeground, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .thread-preview { font-size: 11px; color: var(--vscode-foreground, #cccccc); opacity: 0.7; margin-top: 2px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .status-badge { font-size: 10px; padding: 1px 4px; border-radius: 2px; }
    .status-open { background: #3a8a3a40; color: #4ec44e; }
    .status-resolved { background: #8a3a3a40; color: #c44e4e; }
    .stale-badge { font-size: 10px; padding: 1px 4px; border-radius: 2px; background: #8a7a3a40; color: #c4a04e; }
    .intent-badge { font-size: 10px; padding: 1px 4px; border-radius: 2px; background: #3a5a8a40; color: #4e8ac4; }
    .reply-count { font-size: 10px; color: var(--vscode-disabledForeground, #888); }
    .comments { margin-left: 16px; border-left: 2px solid var(--vscode-widget-border, #454545); padding-left: 8px; }
    .comment { padding: 4px 0; }
    .comment-author { font-size: 11px; font-weight: 600; }
    .comment-body { font-size: 12px; margin-top: 2px; }
    .comment-time { font-size: 10px; color: var(--vscode-disabledForeground, #888); margin-left: 6px; }
    .filter-bar { display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-bottom: 1px solid var(--vscode-widget-border, #454545); font-size: 11px; flex-shrink: 0; }
    .filter-summary { flex: 1; color: var(--vscode-disabledForeground, #888); }
    .btn { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; padding: 2px 8px; border-radius: 2px; cursor: pointer; font-size: 11px; }
    .btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
  </style>
</head>
<body>
  <div class="filter-bar">
    <span class="filter-summary" id="filter-summary">Loading…</span>
    <button class="btn" id="btn-clear">Clear</button>
    <button class="btn" id="btn-group">Group</button>
  </div>
  <div id="panel">
    <div class="empty">No comments yet. Select code and press Ctrl+Enter to add one.</div>
  </div>
  <script nonce="${nonce}">
    (function() {
      const panel = document.getElementById('panel');
      const filterSummary = document.getElementById('filter-summary');

      function renderPanel(model) {
        if (!filterSummary) return;
        filterSummary.textContent = model.filtersSummary || 'All comments';

        if (!model.groups || model.groups.length === 0) {
          panel.innerHTML = '<div class="empty">No comments match the current filters.</div>';
          return;
        }

        let html = '';
        for (const group of model.groups) {
          html += '<div class="group' + (group.expanded ? ' expanded' : '') + '" data-group-id="' + group.groupId + '">';
          html += '<div class="group-header' + (group.expanded ? ' expanded' : '') + '" data-group-id="' + group.groupId + '">' + group.label + ' (' + group.count + ')</div>';
          if (group.expanded) {
            html += '<div class="group-threads">';
            for (const thread of group.threads) {
              html += '<div class="thread" data-thread-id="' + thread.threadId + '">';
              html += '<div class="thread-meta">';
              html += '<div class="thread-title">' + escapeHtml(thread.title) + '</div>';
              html += '<div class="thread-subtitle">' + escapeHtml(thread.subtitle) + '</div>';
              if (thread.preview) html += '<div class="thread-preview">' + escapeHtml(thread.preview) + '</div>';
              html += '</div>';
              const badges = [];
              if (thread.status === 'open') badges.push('<span class="status-badge status-open">open</span>');
              else badges.push('<span class="status-badge status-resolved">resolved</span>');
              if (thread.stale) badges.push('<span class="stale-badge">stale</span>');
              if (thread.intent) badges.push('<span class="intent-badge">' + thread.intent + '</span>');
              if (thread.replyCount > 0) badges.push('<span class="reply-count">' + thread.replyCount + ' repl' + (thread.replyCount === 1 ? 'y' : 'ies') + '</span>');
              html += '<div class="thread-badges" style="display:flex;gap:4px;flex-shrink:0;">' + badges.join('') + '</div>';
              html += '</div>';
              if (thread.expanded && thread.comments && thread.comments.length > 0) {
                html += '<div class="comments">';
                for (const c of thread.comments) {
                  html += '<div class="comment">';
                  html += '<span class="comment-author">' + escapeHtml(c.authorName) + '</span>';
                  html += '<span class="comment-time">' + escapeHtml(c.createdAt) + '</span>';
                  html += '<div class="comment-body">' + escapeHtml(c.body) + '</div>';
                  html += '</div>';
                }
                html += '</div>';
              }
              html += '</div>';
            }
            html += '</div>';
          }
          html += '</div>';
        }
        panel.innerHTML = html;

        // Attach event listeners
        for (const btn of panel.querySelectorAll('.group-header')) {
          btn.addEventListener('click', function() {
            const groupId = this.getAttribute('data-group-id');
            vscode.postMessage({ type: 'panel:toggle-group', groupId: groupId, source: 'mouse' });
          });
        }
        for (const btn of panel.querySelectorAll('.thread')) {
          btn.addEventListener('click', function(e) {
            if (e.target.tagName === 'BUTTON') return;
            const threadId = this.getAttribute('data-thread-id');
            vscode.postMessage({ type: 'panel:toggle-thread', threadId: threadId, source: 'mouse' });
          });
        }
      }

      function escapeHtml(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      document.getElementById('btn-clear')?.addEventListener('click', function() {
        vscode.postMessage({ type: 'panel:invoke-global-command', commandId: 'accordo.commentsPanel.clearFilters', source: 'mouse' });
      });
      document.getElementById('btn-group')?.addEventListener('click', function() {
        vscode.postMessage({ type: 'panel:invoke-global-command', commandId: 'accordo.commentsPanel.groupBy', source: 'mouse' });
      });

      window.addEventListener('message', function(event) {
        const msg = event.data;
        if (msg && msg.type === 'panel:state') {
          renderPanel(msg.model);
        }
      });

      // Signal that the webview is ready
      vscode.postMessage({ type: 'panel:ready', apiVersion: '1' });
    })();
  </script>
</body>
</html>`;
  }
}

// ── wireWebviewPanelAndCommands ───────────────────────────────────────────────

/**
 * M45-EXT: Creates the WebviewView-based Comments Panel.
 *
 * Replaces the TreeView-based panel with a WebviewView, wiring:
 *   - CommentsWebviewViewProvider (registered as accordo-comments-panel)
 *   - Panel commands (via registerPanelCommands) using the provider as surface
 *   - RuntimeMessageHandler for webview→host message dispatch
 *   - buildCommentsPanelViewModel for view model derivation
 *
 * Returns an array of disposables to be pushed into context.subscriptions.
 */
export function wireWebviewPanelAndCommands(
  context: vscode.ExtensionContext,
  store: CommentStore,
  nc: NativeComments,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // ── Panel UI state (ephemeral — lives in the provider) ─────────────────────
  const uiState: CommentsPanelUiState = {
    expandedThreadIds: new Set(),
    collapsedGroupIds: new Set(),
  };

  // ── Projection store adapter ────────────────────────────────────────────────
  const projectionStore: CommentsPanelProjectionStore = {
    getAllThreads: () => store.getAllThreads(),
    isThreadStale: (id: string) => store.isThreadStale(id),
  };

  // ── Panel Filters ───────────────────────────────────────────────────────────
  const filters = new PanelFilters(context.workspaceState);

  // ── View model source ───────────────────────────────────────────────────────
  const viewModelSource = {
    buildViewModel(targetUiState: CommentsPanelUiState) {
      return buildCommentsPanelViewModel(projectionStore, filters, targetUiState);
    },
  };

  // ── HTML Renderer ──────────────────────────────────────────────────────────
  const htmlRenderer = new WebviewPanelHtmlRenderer();

  // ── WebviewView Provider (created first to break circular deps) ─────────────
  // The message handler needs the provider.postMessage, so create provider first.
  // Provider is defined before messageHandler below (see below).
  let _provider: CommentsWebviewViewProvider;

  // ── Message handler (uses _provider.postMessage via closure) ───────────────
  // uiStateContainer is mutable; getUiState() returns a readonly projection
  const uiStateContainer = { current: uiState };
  const messageHandler = new RuntimeMessageHandler({
    postMessage: (msg) => _provider.postMessage(msg),
    buildViewModel: viewModelSource.buildViewModel,
    getStore: () => store,
    executeCommand: (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args),
    getUiState: () => uiStateContainer.current,
    mutateUiState: (fn) => {
      const next = fn(uiStateContainer.current);
      uiStateContainer.current = next;
    },
  });

  // ── WebviewView Provider (now we have messageHandler ready) ─────────────────
  _provider = new CommentsWebviewViewProvider(htmlRenderer, viewModelSource, messageHandler);
  disposables.push(
    vscode.window.registerWebviewViewProvider("accordo-comments-panel", _provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // ── Navigation environment ──────────────────────────────────────────────────
  const navEnv: NavigationEnv = {
    showTextDocument: (uri, options) => vscode.window.showTextDocument(uri, options),
    executeCommand: (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args),
    showWarningMessage: (msg) => vscode.window.showWarningMessage(msg),
    showInformationMessage: (msg) => vscode.window.showInformationMessage(msg),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    visibleTextEditorUris: () => vscode.window.visibleTextEditors.map((e) => e.document.uri.toString()),
    activeTextEditorUri: () => vscode.window.activeTextEditor?.document.uri.toString(),
  };

  // ── Panel commands (provider is the PanelPresentationSurface) ──────────────
  const panelDisposables = registerPanelCommands(
    context,
    store,
    nc,
    navEnv,
    filters,
    _provider, // PanelPresentationSurface — uses provider.refresh()
  );
  disposables.push(...panelDisposables);

  // ── Register accordo.comments.new (user-facing) ───────────────────────────
  // Called by controller.acceptInputCommand when user presses Ctrl+Enter / Save.
  disposables.push(
    vscode.commands.registerCommand(
      "accordo.comments.new",
      async (reply: { thread: vscode.CommentThread; text: string }) => {
        if (!reply?.thread || !reply.text.trim()) return;
        const existingId = nc.getThreadIdForWidget(reply.thread);
        if (existingId) {
          await store.reply({
            threadId: existingId,
            body: reply.text,
            author: { kind: "user", name: "User" },
          });
        } else {
          const uri = reply.thread.uri.toString();
          const range = reply.thread.range;
          reply.thread.dispose();
          const anchor = range
            ? {
                kind: "text" as const,
                uri,
                range: {
                  startLine: range.start.line,
                  startChar: range.start.character,
                  endLine: range.end.line,
                  endChar: range.end.character,
                },
                docVersion: 0,
              }
            : { kind: "file" as const, uri };
          await store.createThread({
            uri,
            anchor,
            body: reply.text,
            author: { kind: "user", name: "User" },
          });
        }
      },
    ),
  );

  // ── Text document change → staleness tracking ─────────────────────────────
  disposables.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      store.onDocumentChanged({
        uri: event.document.uri.toString(),
        changes: event.contentChanges.map((c) => ({
          startLine: c.range.start.line,
          endLine: c.range.end.line + 1,
          newLineCount: c.text.split("\n").length - 1,
        })),
      });
      for (const thread of store.getAllThreads()) {
        if (store.isThreadStale(thread.id)) {
          nc.markStale(thread.id);
        }
      }
    }),
  );

  // ── Store change → refresh the panel ────────────────────────────────────────
  disposables.push(
    store.onChanged(() => {
      _provider.refresh();
    }),
  );

  return disposables;
}

// ── Legacy TreeView wiring (still used until migration is complete) ────────────

/**
 * Creates the custom Comments Panel view using the legacy TreeView approach.
 *
 * Returns an array of disposables to be pushed into context.subscriptions.
 * @deprecated Use wireWebviewPanelAndCommands instead.
 */
export function wirePanelAndCommands(
  context: vscode.ExtensionContext,
  store: CommentStore,
  nc: NativeComments,
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  const filters = new PanelFilters(context.workspaceState);
  const treeProvider = new CommentsTreeProvider(store, filters);
  const treeView = vscode.window.createTreeView("accordo-comments-panel", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  disposables.push(treeView);

  const navEnv: NavigationEnv = {
    showTextDocument: (uri, options) => vscode.window.showTextDocument(uri, options),
    executeCommand: (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args),
    showWarningMessage: (msg) => vscode.window.showWarningMessage(msg),
    showInformationMessage: (msg) => vscode.window.showInformationMessage(msg),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    visibleTextEditorUris: () => vscode.window.visibleTextEditors.map((e) => e.document.uri.toString()),
    activeTextEditorUri: () => vscode.window.activeTextEditor?.document.uri.toString(),
  };

  const panelDisposables = registerPanelCommands(
    context,
    store,
    nc,
    navEnv,
    filters,
    treeProvider,
  );
  disposables.push(...panelDisposables);

  disposables.push(
    vscode.commands.registerCommand(
      "accordo.comments.new",
      async (reply: { thread: vscode.CommentThread; text: string }) => {
        if (!reply?.thread || !reply.text.trim()) return;
        const existingId = nc.getThreadIdForWidget(reply.thread);
        if (existingId) {
          await store.reply({
            threadId: existingId,
            body: reply.text,
            author: { kind: "user", name: "User" },
          });
        } else {
          const uri = reply.thread.uri.toString();
          const range = reply.thread.range;
          reply.thread.dispose();
          const anchor = range
            ? {
                kind: "text" as const,
                uri,
                range: {
                  startLine: range.start.line,
                  startChar: range.start.character,
                  endLine: range.end.line,
                  endChar: range.end.character,
                },
                docVersion: 0,
              }
            : { kind: "file" as const, uri };
          await store.createThread({
            uri,
            anchor,
            body: reply.text,
            author: { kind: "user", name: "User" },
          });
        }
      },
    ),
  );

  disposables.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      store.onDocumentChanged({
        uri: event.document.uri.toString(),
        changes: event.contentChanges.map((c) => ({
          startLine: c.range.start.line,
          endLine: c.range.end.line + 1,
          newLineCount: c.text.split("\n").length - 1,
        })),
      });
      for (const thread of store.getAllThreads()) {
        if (store.isThreadStale(thread.id)) {
          nc.markStale(thread.id);
        }
      }
    }),
  );

  return disposables;
}

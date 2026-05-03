import * as vscode from "vscode";
import type { CommentStore } from "./comment-store.js";
import type { NativeComments } from "./native-comments.js";
import { buildCommentsPanelViewModel, type CommentsPanelProjectionStore } from "./panel/comments-projection-builder.js";
import { RuntimeMessageHandler } from "./panel/comments-message-handler.js";
import { WebviewPanelHtmlRenderer } from "./panel/comments-webview-html-renderer.js";
import { CommentsWebviewViewProvider } from "./panel/comments-webview-provider.js";
import type { CommentsPanelUiState } from "./panel/comments-webview-contract.js";
import { registerPanelCommands } from "./panel/panel-commands.js";
import { PanelFilters } from "./panel/panel-filters.js";
import {
  createPanelNavigationEnv,
  registerNewCommentCommand,
  createStalenessTracker,
} from "./panel/panel-shared-helpers.js";
export { wirePanelAndCommands } from "./panel-tree-bootstrap.js";

export function wireWebviewPanelAndCommands(
  context: vscode.ExtensionContext,
  store: CommentStore,
  nc: NativeComments,
): vscode.Disposable[] {
  const filters = new PanelFilters(context.workspaceState);
  const provider = createCommentsWebviewProvider(store, filters);
  const navEnv = createPanelNavigationEnv();
  return [
    vscode.window.registerWebviewViewProvider("accordo-comments-panel", provider, { webviewOptions: { retainContextWhenHidden: true } }),
    ...registerPanelCommands(context, store, nc, navEnv, filters, provider),
    registerNewCommentCommand(store, nc),
    createStalenessTracker(store, nc),
    store.onChanged(() => provider.refresh()),
  ];
}

function createCommentsWebviewProvider(store: CommentStore, filters: PanelFilters): CommentsWebviewViewProvider {
  const projectionStore: CommentsPanelProjectionStore = {
    getAllThreads: () => store.getAllThreads(),
    isThreadStale: (id) => store.isThreadStale(id),
  };
  const viewModelSource = {
    buildViewModel: (uiState: CommentsPanelUiState) => buildCommentsPanelViewModel(projectionStore, filters, uiState),
  };
  let provider: CommentsWebviewViewProvider;
  const handler = new RuntimeMessageHandler({
    postMessage: (msg) => provider.postMessage(msg),
    buildViewModel: viewModelSource.buildViewModel,
    getStore: () => store,
    executeCommand: (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args),
    getUiState: () => provider.getUiState(),
    mutateUiState: (fn) => provider.mutateUiState(fn),
    refresh: () => provider.refresh(),
    submitReply: async (threadId, body) => {
      await store.reply({ threadId, body, author: { kind: "user", name: "User" } });
    },
    setStatus: (status) => filters.setStatus(status),
    setGroupMode: (mode) => filters.setGroupMode(mode),
    setAuthorKind: (kind) => filters.setAuthorKind(kind),
    setSearchQuery: (query) => filters.setSearchQuery(query),
    clearFilters: () => filters.clear(),
  });
  provider = new CommentsWebviewViewProvider(new WebviewPanelHtmlRenderer(), viewModelSource, handler);
  return provider;
}

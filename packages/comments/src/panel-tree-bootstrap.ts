import * as vscode from "vscode";
import type { CommentStore } from "./comment-store.js";
import type { NativeComments } from "./native-comments.js";
import { CommentsTreeProvider } from "./panel/comments-tree-provider.js";
import { registerPanelCommands } from "./panel/panel-commands.js";
import { PanelFilters } from "./panel/panel-filters.js";
import {
  createPanelNavigationEnv,
  registerNewCommentCommand,
  createStalenessTracker,
} from "./panel/panel-shared-helpers.js";

/** @deprecated Legacy TreeView panel wiring kept for tests/backward reference. */
export function wirePanelAndCommands(
  context: vscode.ExtensionContext,
  store: CommentStore,
  nc: NativeComments,
): vscode.Disposable[] {
  const filters = new PanelFilters(context.workspaceState);
  const treeProvider = new CommentsTreeProvider(store, filters);
  const treeView = vscode.window.createTreeView("accordo-comments-panel", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  const navEnv = createPanelNavigationEnv();
  return [
    treeView,
    ...registerPanelCommands(context, store, nc, navEnv, filters, treeProvider),
    registerNewCommentCommand(store, nc),
    createStalenessTracker(store, nc),
  ];
}
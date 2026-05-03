import * as vscode from "vscode";
import type {
  CommentsPanelHostMessage,
  CommentsPanelUiState,
  CommentsPanelViewModel,
  CommentsPanelWebviewMessage,
} from "./comments-webview-contract.js";

export interface CommentsPanelViewModelSource {
  buildViewModel(uiState: CommentsPanelUiState): CommentsPanelViewModel;
}

export interface CommentsPanelWebviewMessageHandler {
  handleMessage(message: CommentsPanelWebviewMessage): Promise<void>;
}

export interface CommentsPanelWebviewErrorReporter {
  publishError(message: CommentsPanelHostMessage): Thenable<boolean> | undefined;
}

export interface CommentsPanelWebviewHtmlRenderer {
  renderInitialHtml(webview: vscode.Webview): string;
}

export class CommentsWebviewViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private _view: vscode.WebviewView | undefined;
  // Internally mutable; getUiState() exposes readonly projection
  private _expandedThreadIds = new Set<string>();
  private _collapsedGroupIds = new Set<string>();

  constructor(
    private readonly _htmlRenderer: CommentsPanelWebviewHtmlRenderer,
    private readonly _modelSource: CommentsPanelViewModelSource,
    private readonly _messageHandler: CommentsPanelWebviewMessageHandler,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    this._view.webview.options = {
      enableScripts: true,
    };
    this._view.webview.html = this._htmlRenderer.renderInitialHtml(this._view.webview);
    this._view.webview.onDidReceiveMessage((message: CommentsPanelWebviewMessage) => {
      void this._messageHandler.handleMessage(message);
    });
    // Send initial panel state to the newly resolved webview (M45-WV-03)
    this.refresh();
  }

  /**
   * Refresh the panel by rebuilding the view model and posting to the webview.
   * Uses the provider's owned UI state (expanded threads, collapsed groups)
   * so expansion/collapse persists across refreshes (M45-WV-06).
   */
  refresh(): void {
    if (!this._view) return;
    const uiState: CommentsPanelUiState = {
      expandedThreadIds: this._expandedThreadIds,
      collapsedGroupIds: this._collapsedGroupIds,
    };
    const model = this._modelSource.buildViewModel(uiState);
    void this._view.webview.postMessage({ type: "panel:state", model });
  }

  /**
   * Returns the current ephemeral UI state (M45-WV-06).
   * Exposed for the message handler to read/write toggle state.
   */
  getUiState(): CommentsPanelUiState {
    return {
      expandedThreadIds: this._expandedThreadIds,
      collapsedGroupIds: this._collapsedGroupIds,
    };
  }

  /**
   * Mutates ephemeral UI state: expanded threads and collapsed groups.
   * Does NOT mutate the store (M45-WV-07).
   */
  mutateUiState(fn: (s: CommentsPanelUiState) => CommentsPanelUiState): void {
    const next = fn(this.getUiState());
    this._expandedThreadIds = new Set(next.expandedThreadIds);
    this._collapsedGroupIds = new Set(next.collapsedGroupIds);
  }

  /**
   * Post a message to the webview. Returns undefined if view is not resolved.
   */
  postMessage(message: CommentsPanelHostMessage): Thenable<boolean> | undefined {
    if (!this._view) return undefined;
    return this._view.webview.postMessage(message);
  }

  getCurrentView(): vscode.WebviewView | undefined {
    return this._view;
  }

  dispose(): void {
    this._view = undefined;
  }
}

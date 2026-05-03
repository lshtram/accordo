/**
 * accordo-comments — Webview Panel Message Handler
 *
 * Host-side runtime validation and dispatch for webview→host messages.
 *
 * Contract (M45-WVC-01..07):
 *  1. unknown message type → { type: "panel:error", code: "unknown-message", ... }
 *  2. malformed payload / missing required field → { type: "panel:error", code: "invalid-payload", ... }
 *  3. invalid command scope → invalid-command-scope
 *  4. missing threadId for thread-scoped command → missing-thread-id
 *  5. unknown threadId for thread-scoped command → thread-not-found
 *  6. downstream command failure → command-failed
 *
 * panel:toggle-thread / panel:toggle-group → ephemeral UI state only, no store touch
 * panel:ready → postMessage({ type: "panel:state", model: buildViewModel(uiState) })
 * panel:invoke-global-command → executeCommand(id, [])
 * panel:invoke-thread-command → executeCommand(id, [threadId])
 */

import type {
  CommentsPanelErrorCode,
  CommentsPanelHostMessage,
  CommentsPanelInteractionSource,
  CommentsPanelUiState,
  CommentsPanelViewModel,
  CommentsPanelWebviewMessage,
} from "./comments-webview-contract.js";

export interface RuntimeMessageHandlerDeps {
  readonly postMessage: (msg: CommentsPanelHostMessage) => Thenable<boolean> | undefined;
  readonly buildViewModel: (uiState: CommentsPanelUiState) => CommentsPanelViewModel;
  readonly getStore: () => {
    getAllThreads(): readonly { id: string }[];
  };
  readonly executeCommand: (cmd: string, ...args: unknown[]) => Thenable<unknown>;
  readonly getUiState: () => CommentsPanelUiState;
  readonly mutateUiState: (fn: (s: CommentsPanelUiState) => CommentsPanelUiState) => void;
}

export class RuntimeMessageHandler {
  constructor(private readonly _deps: RuntimeMessageHandlerDeps) {}

  async handleMessage(msg: unknown): Promise<void> {
    // Validate message type first
    if (!isValidWebviewMessage(msg)) {
      this._postError("unknown-message", `Unknown message type`, true);
      return;
    }

    const typedMsg = msg as CommentsPanelWebviewMessage;

    switch (typedMsg.type) {
      case "panel:ready": {
        const uiState = this._deps.getUiState();
        const model = this._deps.buildViewModel(uiState);
        this._deps.postMessage({ type: "panel:state", model });
        break;
      }

      case "panel:toggle-thread": {
        const { threadId } = typedMsg;
        const store = this._deps.getStore();
        // Validate thread exists — non-fatal for toggle
        if (threadId) {
          const exists = store.getAllThreads().some((t) => t.id === threadId);
          if (!exists) {
            this._postError("thread-not-found", `Thread ${threadId} not found`, true);
            break;
          }
        }
        // Toggle is ephemeral UI state only — just mutate uiState
        const current = this._deps.getUiState();
        const expanded = current.expandedThreadIds.has(threadId);
        const newExpanded = expanded
          ? new Set([...current.expandedThreadIds].filter((id) => id !== threadId))
          : new Set([...current.expandedThreadIds, threadId]);
        this._deps.mutateUiState((s) => ({
          ...s,
          expandedThreadIds: newExpanded,
        }));
        break;
      }

      case "panel:toggle-group": {
        const { groupId } = typedMsg;
        const current = this._deps.getUiState();
        const collapsed = current.collapsedGroupIds.has(groupId);
        const newCollapsed = collapsed
          ? new Set([...current.collapsedGroupIds].filter((id) => id !== groupId))
          : new Set([...current.collapsedGroupIds, groupId]);
        this._deps.mutateUiState((s) => ({
          ...s,
          collapsedGroupIds: newCollapsed,
        }));
        break;
      }

      case "panel:invoke-global-command": {
        const { commandId } = typedMsg;
        await this._deps.executeCommand(commandId);
        break;
      }

      case "panel:invoke-thread-command": {
        const { commandId, threadId } = typedMsg;
        if (!threadId) {
          this._postError("missing-thread-id", `threadId is required for ${commandId}`, true);
          break;
        }
        const store = this._deps.getStore();
        const exists = store.getAllThreads().some((t) => t.id === threadId);
        if (!exists) {
          this._postError("thread-not-found", `Thread ${threadId} not found`, true);
          break;
        }
        await this._deps.executeCommand(commandId, threadId);
        break;
      }

      default: {
        // Exhaustiveness check — shouldn't reach here
        this._postError("unknown-message", `Unknown message type`, true);
      }
    }
  }

  private _postError(code: CommentsPanelErrorCode, message: string, recoverable: boolean): void {
    this._deps.postMessage({ type: "panel:error", code, message, recoverable });
  }
}

// ── Type guard ───────────────────────────────────────────────────────────────

function isValidWebviewMessage(msg: unknown): msg is CommentsPanelWebviewMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  if (typeof m["type"] !== "string") return false;
  const validTypes = [
    "panel:ready",
    "panel:toggle-group",
    "panel:toggle-thread",
    "panel:invoke-global-command",
    "panel:invoke-thread-command",
  ];
  return validTypes.includes(m["type"]);
}

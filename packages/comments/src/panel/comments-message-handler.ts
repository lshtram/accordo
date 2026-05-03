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
 *
 * Validation order (M45-WVC-02, M45-WVC-09):
 *  - Per-kind required fields validated before any state mutation, command execution,
 *    scope validation, or thread lookup.
 *  - source is required on all toggle/invoke messages.
 *  - apiVersion ("1") is required on panel:ready.
 */

import type {
  CommentsPanelErrorCode,
  CommentsPanelGlobalCommandId,
  CommentsPanelHostMessage,
  CommentsPanelInteractionSource,
  CommentsPanelThreadCommandId,
  CommentsPanelUiState,
  CommentsPanelViewModel,
  CommentsPanelWebviewMessage,
} from "./comments-webview-contract.js";
import type { CommentThread } from "@accordo/bridge-types";

const VALID_SOURCES: readonly CommentsPanelInteractionSource[] = ["mouse", "keyboard", "programmatic"];

export interface RuntimeMessageHandlerDeps {
  readonly postMessage: (msg: CommentsPanelHostMessage) => Thenable<boolean> | undefined;
  readonly buildViewModel: (uiState: CommentsPanelUiState) => CommentsPanelViewModel;
  readonly getStore: () => {
    getAllThreads(): readonly Pick<CommentThread, "id">[];
  };
  readonly executeCommand: (cmd: string, ...args: unknown[]) => Thenable<unknown>;
  readonly getUiState: () => CommentsPanelUiState;
  readonly mutateUiState: (fn: (s: CommentsPanelUiState) => CommentsPanelUiState) => void;
  readonly refresh: () => void;
}

export class RuntimeMessageHandler {
  constructor(private readonly _deps: RuntimeMessageHandlerDeps) {}

  async handleMessage(msg: unknown): Promise<void> {
    if (!isValidWebviewMessage(msg)) {
      this._postError("unknown-message", `Unknown message type`, true);
      return;
    }

    const typedMsg = msg as CommentsPanelWebviewMessage;

    // M45-WVC-02, M45-WVC-09: validate required fields before any mutation/execution
    switch (typedMsg.type) {
      case "panel:ready":
        if (!isValidApiVersion(typedMsg.apiVersion)) {
          this._postError("invalid-payload", "apiVersion is required and must be '1' for panel:ready", true);
          return;
        }
        break;
      case "panel:toggle-thread":
      case "panel:toggle-group":
      case "panel:invoke-global-command":
      case "panel:invoke-thread-command":
        if (!isValidSource(typedMsg.source)) {
          this._postError("invalid-payload", `source is required and must be one of ${VALID_SOURCES.join(", ")}`, true);
          return;
        }
        break;
    }

    switch (typedMsg.type) {
      case "panel:ready":
        await this._handlePanelReady();
        break;
      case "panel:toggle-thread":
        await this._handleToggleThread(typedMsg.threadId);
        break;
      case "panel:toggle-group":
        await this._handleToggleGroup(typedMsg.groupId);
        break;
      case "panel:invoke-global-command":
        await this._handleInvokeGlobalCommand(typedMsg.commandId);
        break;
      case "panel:invoke-thread-command":
        await this._handleInvokeThreadCommand(typedMsg.commandId, typedMsg.threadId);
        break;
      default:
        this._postError("unknown-message", `Unknown message type`, true);
    }
  }

  private async _handlePanelReady(): Promise<void> {
    const uiState = this._deps.getUiState();
    const model = this._deps.buildViewModel(uiState);
    this._deps.postMessage({ type: "panel:state", model });
  }

  private async _handleToggleThread(threadId: string): Promise<void> {
    if (!threadId || typeof threadId !== "string") {
      this._postError("invalid-payload", "threadId is required for panel:toggle-thread", true);
      return;
    }
    const store = this._deps.getStore();
    const exists = store.getAllThreads().some((t) => t.id === threadId);
    if (!exists) {
      this._postError("thread-not-found", `Thread ${threadId} not found`, true);
      return;
    }
    const current = this._deps.getUiState();
    const expanded = current.expandedThreadIds.has(threadId);
    const newExpanded = expanded
      ? new Set([...current.expandedThreadIds].filter((id) => id !== threadId))
      : new Set([...current.expandedThreadIds, threadId]);
    this._deps.mutateUiState((s) => ({ ...s, expandedThreadIds: newExpanded }));
    this._deps.refresh();
  }

  private async _handleToggleGroup(groupId: string): Promise<void> {
    if (!groupId || typeof groupId !== "string") {
      this._postError("invalid-payload", "groupId is required for panel:toggle-group", true);
      return;
    }
    const current = this._deps.getUiState();
    const collapsed = current.collapsedGroupIds.has(groupId);
    const newCollapsed = collapsed
      ? new Set([...current.collapsedGroupIds].filter((id) => id !== groupId))
      : new Set([...current.collapsedGroupIds, groupId]);
    this._deps.mutateUiState((s) => ({ ...s, collapsedGroupIds: newCollapsed }));
    this._deps.refresh();
  }

  private async _handleInvokeGlobalCommand(commandId: string): Promise<void> {
    if (!commandId || typeof commandId !== "string") {
      this._postError("invalid-payload", "commandId is required for panel:invoke-global-command", true);
      return;
    }
    if (!isGlobalCommandId(commandId)) {
      this._postError("invalid-command-scope", `Command ${commandId} is not a global command`, true);
      return;
    }
    await this._deps.executeCommand(commandId);
  }

  private async _handleInvokeThreadCommand(commandId: string, threadId: string): Promise<void> {
    if (!commandId || typeof commandId !== "string") {
      this._postError("invalid-payload", "commandId is required for panel:invoke-thread-command", true);
      return;
    }
    if (!isThreadCommandId(commandId)) {
      this._postError("invalid-command-scope", `Command ${commandId} is not a thread-scoped command`, true);
      return;
    }
    // Distinguish missing (undefined) from wrong type (non-string, including null).
    if (threadId === undefined) {
      this._postError("missing-thread-id", `threadId is required for ${commandId}`, true);
      return;
    }
    if (typeof threadId !== "string") {
      this._postError("invalid-payload", `threadId is required for panel:invoke-thread-command`, true);
      return;
    }
    const store = this._deps.getStore();
    const thread = store.getAllThreads().find((t) => t.id === threadId);
    if (!thread) {
      this._postError("thread-not-found", `Thread ${threadId} not found`, true);
      return;
    }
    await this._deps.executeCommand(commandId, thread);
  }

  private _postError(code: CommentsPanelErrorCode, message: string, recoverable: boolean): void {
    this._deps.postMessage({ type: "panel:error", code, message, recoverable });
  }
}

// ── Command scope validation ──────────────────────────────────────────────────

const GLOBAL_COMMAND_IDS = new Set<string>([
  "accordo.commentsPanel.refresh",
  "accordo.commentsPanel.filterByStatus",
  "accordo.commentsPanel.filterByIntent",
  "accordo.commentsPanel.clearFilters",
  "accordo.commentsPanel.groupBy",
  "accordo.commentsPanel.deleteAllBrowserComments",
]);

const THREAD_COMMAND_IDS = new Set<string>([
  "accordo.commentsPanel.navigateToAnchor",
  "accordo.commentsPanel.resolve",
  "accordo.commentsPanel.reopen",
  "accordo.commentsPanel.reply",
  "accordo.commentsPanel.delete",
]);

function isGlobalCommandId(id: string): id is CommentsPanelGlobalCommandId {
  return GLOBAL_COMMAND_IDS.has(id);
}

function isThreadCommandId(id: string): id is CommentsPanelThreadCommandId {
  return THREAD_COMMAND_IDS.has(id);
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

function isValidApiVersion(v: unknown): v is "1" {
  return v === "1";
}

function isValidSource(s: unknown): s is CommentsPanelInteractionSource {
  return VALID_SOURCES.includes(s as CommentsPanelInteractionSource);
}

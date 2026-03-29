/**
 * Bridge State Publisher — Slim Orchestrator
 *
 * Maintains IDE state locally from VSCode events, pushes debounced diff
 * patches to Hub between keyframes, and sends periodic full snapshots
 * (keyframes) to guard against drift. Hub can also pull fresh state at
 * any time via getState.
 *
 * Design: hybrid push-diffs + pull + periodic keyframe.
 *   - VSCode events → update local state → debounced stateUpdate patches
 *   - Every KEYFRAME_INTERVAL_MS → full stateSnapshot (corrects drift)
 *   - Hub getState request → immediate full stateSnapshot reply
 *   - Modality updates from extensions → immediate stateUpdate push
 *
 * Requirements: requirements-bridge.md §6 (§6.1–§6.4)
 */

import type {
  IDEState,
  StateSnapshotMessage,
  StateUpdateMessage,
} from "@accordo/bridge-types";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";
import {
  collectCurrentState,
  deriveOpenEditors,
  deriveOpenTabs,
  normalizePath,
  EDITOR_DEBOUNCE_MS,
  TAB_DEBOUNCE_MS,
  KEYFRAME_INTERVAL_MS,
} from "./state-collector.js";
import { computePatch, emptyState } from "./state-diff.js";

// Re-export types and constants so existing importers continue to work
export type {
  TextDocument,
  TextEditor,
  TextEditorSelectionChangeEvent,
  Terminal,
  WorkspaceFolder,
  WorkspaceFoldersChangeEvent,
  TabInputText,
  TabInputWebview,
  Tab,
  TabGroup,
  VsDisposable,
  VsEvent,
  VscodeApi,
} from "./state-collector.js";
export { normalizePath, EDITOR_DEBOUNCE_MS, TAB_DEBOUNCE_MS, KEYFRAME_INTERVAL_MS } from "./state-collector.js";

// ── Send callback types ───────────────────────────────────────────────────────

/**
 * Callbacks from WsClient for outbound WS messages.
 */
export interface StatePublisherSend {
  /** Send a full stateSnapshot (connect, reconnect, keyframe, getState). */
  sendSnapshot(message: StateSnapshotMessage): void;
  /** Send a partial stateUpdate (diff patches + modality pushes). */
  sendUpdate(message: StateUpdateMessage): void;
}

// ── StatePublisher ────────────────────────────────────────────────────────────

/**
 * Maintains IDE state locally and keeps Hub informed.
 *
 * §6.1: Subscribes to the seven VSCode events and maps them to IDEState
 *        fields with debounced diff pushes (50ms editor, 100ms tabs,
 *        immediate for workspace folders).
 * §6.2: All paths normalized to absolute + forward slashes.
 * §6.3: Tracks last-sent state; pushes only changed fields as stateUpdate.
 *        Full stateSnapshot sent on connect/reconnect, on Hub getState
 *        request, and every KEYFRAME_INTERVAL_MS.
 * §6.4: publishState() stores modality state and sends stateUpdate push
 *        immediately (extension-driven, infrequent).
 */
export class StatePublisher {
  private vscode: import("./state-collector.js").VscodeApi;
  private send: StatePublisherSend;

  /** Current local snapshot of all IDE state fields — always up to date */
  private currentState: IDEState;

  /** Last state that was actually sent to Hub (for diff computation) */
  private sentState: IDEState | null = null;

  /** Active event listener disposables */
  private disposables: import("./state-collector.js").VsDisposable[] = [];

  /** Pending debounce timers keyed by category */
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Periodic keyframe timer handle */
  private keyframeTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param vscodeApi  Injected VSCode API (real or mocked)
   * @param sendFns    Callbacks to WsClient for outbound WS messages
   */
  constructor(
    vscodeApi: import("./state-collector.js").VscodeApi,
    sendFns: StatePublisherSend,
  ) {
    this.vscode = vscodeApi;
    this.send = sendFns;
    this.currentState = StatePublisher.emptyState();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Subscribe to all VSCode events, capture initial state, and start the
   * keyframe timer.
   * Does NOT send any messages — call sendSnapshot() after WS connects.
   *
   * §6.1: Subscribes to all seven event sources.
   */
  start(): void {
    // Capture session-static fields once
    this.currentState.workspaceName = this.vscode.workspace.name ?? null;
    this.currentState.remoteAuthority = this.vscode.env.remoteName ?? null;

    // Capture current IDE state snapshot
    const initial = collectCurrentState(this.vscode, this.currentState.modalities);
    this.currentState = { ...this.currentState, ...initial };

    // Subscribe to all 7 events
    this.subscribeEvents();

    // Start keyframe timer
    this.keyframeTimer = setInterval(() => {
      this.sendSnapshot();
    }, KEYFRAME_INTERVAL_MS);
  }

  /**
   * Subscribe to the seven VSCode events and push all disposables into
   * this.disposables.  Extracted from start() to keep that method < 40 lines.
   */
  private subscribeEvents(): void {
    this.disposables.push(
      this.vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.currentState.activeFile = normalizePath(editor.document.uri.fsPath);
          this.currentState.activeFileLine = editor.selection.active.line + 1;
          this.currentState.activeFileColumn = editor.selection.active.character + 1;
        } else {
          this.currentState.activeFile = null;
          this.currentState.activeFileLine = 1;
          this.currentState.activeFileColumn = 1;
        }
        this.scheduleFlush("editor", EDITOR_DEBOUNCE_MS);
      }),
      this.vscode.window.onDidChangeVisibleTextEditors(() => {
        this.currentState.visibleEditors = Array.from(this.vscode.window.visibleTextEditors).map(
          (e) => normalizePath(e.document.uri.fsPath),
        );
        this.scheduleFlush("editor", EDITOR_DEBOUNCE_MS);
      }),
      this.vscode.window.onDidChangeTextEditorSelection((e) => {
        // Guard: only update cursor position for the currently active file.
        // VSCode fires selection events for non-active editors (peek, inline
        // reference, diff views). Updating state from those would desync
        // activeFileLine/Column from the document the user is actually editing.
        const eventPath = normalizePath(e.textEditor.document.uri.fsPath);
        if (eventPath !== this.currentState.activeFile) return;
        this.currentState.activeFileLine = e.textEditor.selection.active.line + 1;
        this.currentState.activeFileColumn = e.textEditor.selection.active.character + 1;
        this.scheduleFlush("editor", EDITOR_DEBOUNCE_MS);
      }),
      this.vscode.window.onDidChangeActiveTerminal((terminal) => {
        this.currentState.activeTerminal = terminal?.name ?? null;
        this.scheduleFlush("editor", EDITOR_DEBOUNCE_MS);
      }),
      this.vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.currentState.workspaceFolders = (
          this.vscode.workspace.workspaceFolders ?? []
        ).map((f) => normalizePath(f.uri.fsPath));
        // Immediate flush — no debounce for workspace folder changes
        this.flushPatch();
      }),
      this.vscode.window.tabGroups.onDidChangeTabGroups(() => {
        this.currentState.openEditors = deriveOpenEditors(this.vscode.window.tabGroups.all);
        this.currentState.openTabs = deriveOpenTabs(this.vscode.window.tabGroups.all);
        this.scheduleFlush("tabs", TAB_DEBOUNCE_MS);
      }),
      this.vscode.window.tabGroups.onDidChangeTabs(() => {
        this.currentState.openEditors = deriveOpenEditors(this.vscode.window.tabGroups.all);
        this.currentState.openTabs = deriveOpenTabs(this.vscode.window.tabGroups.all);
        this.scheduleFlush("tabs", TAB_DEBOUNCE_MS);
      }),
    );
  }

  /**
   * Unsubscribe all VSCode event listeners, cancel pending debounce timers,
   * and stop the keyframe timer.
   */
  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.keyframeTimer !== null) {
      clearInterval(this.keyframeTimer);
      this.keyframeTimer = null;
    }
  }

  // ── Snapshot / Patch ───────────────────────────────────────────────────────

  /**
   * Send a full stateSnapshot to Hub.
   * Called on connect/reconnect (WS-03/WS-07), by the keyframe timer,
   * and in response to Hub's getState request.
   *
   * §6.3: After sending, resets sentState so subsequent diffs are computed
   *        against this snapshot.
   */
  sendSnapshot(): void {
    const msg: StateSnapshotMessage = {
      type: "stateSnapshot",
      protocolVersion: ACCORDO_PROTOCOL_VERSION,
      state: { ...this.currentState, modalities: { ...this.currentState.modalities } },
    };
    this.send.sendSnapshot(msg);
    this.sentState = { ...this.currentState, modalities: { ...this.currentState.modalities } };
  }

  /**
   * Return the current cached IDEState.
   * Used by BridgeAPI.getState() (local read, no network).
   */
  getState(): IDEState {
    return this.currentState;
  }

  // ── Modality State ─────────────────────────────────────────────────────────

  /**
   * Called by BridgeAPI.publishState().
   * Stores modality state for extensionId and sends a stateUpdate push.
   *
   * §6.4:
   *   1. Store in currentState.modalities[extensionId]
   *   2. Send stateUpdate with { modalities: { [extensionId]: state } }
   *
   * @param extensionId  e.g. "accordo-editor"
   * @param state        Arbitrary JSON-serializable object
   */
  publishState(extensionId: string, state: Record<string, unknown>): void {
    this.currentState.modalities = { ...this.currentState.modalities, [extensionId]: state };
    const msg: StateUpdateMessage = {
      type: "stateUpdate",
      patch: { modalities: { [extensionId]: state } },
    };
    this.send.sendUpdate(msg);
  }

  /**
   * Called when an extension disposes. Removes its modality key and pushes patch.
   *
   * §6.4: Removing key → send stateUpdate with modalities patch.
   */
  removeModalityState(extensionId: string): void {
    if (!(extensionId in this.currentState.modalities)) {
      return;
    }
    const updated = { ...this.currentState.modalities };
    delete updated[extensionId];
    this.currentState.modalities = updated;
    const msg: StateUpdateMessage = {
      type: "stateUpdate",
      patch: { modalities: updated },
    };
    this.send.sendUpdate(msg);
  }

  // ── Internal: diff + flush ────────────────────────────────────────────────

  /**
   * If a patch exists, send it as a stateUpdate and update sentState.
   * Called by debounce timers.
   */
  private flushPatch(): void {
    const patch = computePatch(this.currentState, this.sentState);
    if (patch === null) return;
    const msg: StateUpdateMessage = { type: "stateUpdate", patch };
    this.send.sendUpdate(msg);
    this.sentState = { ...this.currentState, modalities: { ...this.currentState.modalities } };
  }

  // ── Internal: debounce scheduling ─────────────────────────────────────────

  /**
   * Schedule a debounced flush for a given category and delay.
   * Resets the timer on repeated calls within the window.
   */
  private scheduleFlush(category: string, delayMs: number): void {
    const existing = this.debounceTimers.get(category);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(category);
      this.flushPatch();
    }, delayMs);
    this.debounceTimers.set(category, timer);
  }

  /**
   * Build an empty IDEState for initialization.
   */
  static emptyState(): IDEState {
    return emptyState();
  }
}

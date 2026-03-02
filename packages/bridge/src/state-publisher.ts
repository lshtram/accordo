/**
 * Bridge State Publisher
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

// ── VSCode API Abstractions for testability ──────────────────────────────────
// (No direct 'vscode' import — injected at runtime from extension.ts)

/** Minimal TextDocument surface used by StatePublisher */
export interface TextDocument {
  uri: { fsPath: string };
}

/** Minimal TextEditor surface used by StatePublisher */
export interface TextEditor {
  document: TextDocument;
  /** Active cursor position (0-based internally, converted to 1-based for IDEState) */
  selection: { active: { line: number; character: number } };
}

/** Event argument for onDidChangeTextEditorSelection */
export interface TextEditorSelectionChangeEvent {
  textEditor: TextEditor;
}

/** Minimal Terminal surface */
export interface Terminal {
  name: string;
}

/** Minimal workspace folder surface */
export interface WorkspaceFolder {
  uri: { fsPath: string };
}

/** Event argument for onDidChangeWorkspaceFolders */
export interface WorkspaceFoldersChangeEvent {
  readonly added: readonly WorkspaceFolder[];
  readonly removed: readonly WorkspaceFolder[];
}

/**
 * A tab input that represents a document URI.
 * Matches vscode.TabInputText — only uri is used.
 */
export interface TabInputText {
  uri: { fsPath: string };
}

/** Minimal Tab surface: the input may be a text tab or something else */
export interface Tab {
  input?: TabInputText | unknown;
}

/** Minimal TabGroup surface */
export interface TabGroup {
  tabs: Tab[];
}

/** A VSCode Disposable-like */
export interface VsDisposable {
  dispose(): void;
}

/** A VSCode Event<T>: subscribe fn → disposable */
export type VsEvent<T> = (listener: (e: T) => void) => VsDisposable;

/**
 * VSCode API surface required by StatePublisher.
 * Injected from the real `vscode` module in extension.ts.
 * Mocked in tests.
 */
export interface VscodeApi {
  window: {
    activeTextEditor: TextEditor | undefined;
    visibleTextEditors: readonly TextEditor[];
    activeTerminal: Terminal | undefined;
    onDidChangeActiveTextEditor: VsEvent<TextEditor | undefined>;
    onDidChangeVisibleTextEditors: VsEvent<readonly TextEditor[]>;
    onDidChangeTextEditorSelection: VsEvent<TextEditorSelectionChangeEvent>;
    onDidChangeActiveTerminal: VsEvent<Terminal | undefined>;
    tabGroups: {
      all: readonly TabGroup[];
      onDidChangeTabGroups: VsEvent<unknown>;
      onDidChangeTabs: VsEvent<unknown>;
    };
  };
  workspace: {
    workspaceFolders: readonly WorkspaceFolder[] | undefined;
    /** Display name of workspace or root folder, or undefined */
    name: string | undefined;
    onDidChangeWorkspaceFolders: VsEvent<WorkspaceFoldersChangeEvent>;
  };
  env: {
    /**
     * Name of the remote. undefined when running locally.
     * e.g. "ssh-remote", "wsl", "dev-container", "codespaces", "tunnel".
     */
    remoteName: string | undefined;
  };
}

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

// ── Constants ─────────────────────────────────────────────────────────────────

/** Debounce for editor / selection / terminal events (ms) */
export const EDITOR_DEBOUNCE_MS = 50;

/** Debounce for tab group / open editors events (ms) */
export const TAB_DEBOUNCE_MS = 100;

/**
 * Keyframe interval in milliseconds.
 * A full snapshot is pushed to Hub on this schedule to guard against drift.
 * Default: 600 000 ms (10 minutes).
 */
export const KEYFRAME_INTERVAL_MS = 600_000;

// ── Path utilities ────────────────────────────────────────────────────────────

/**
 * Normalize an absolute filesystem path to forward-slash separators.
 * §6.2: All paths in IDEState use forward slashes.
 *
 * @param fsPath  Absolute path as returned by vscode Uri.fsPath
 * @returns       Same path with backslashes replaced by forward slashes
 */
export function normalizePath(fsPath: string): string {
  return fsPath.replace(/\\/g, "/");
}

// ── Type guards ───────────────────────────────────────────────────────────────

/**
 * Narrows an unknown tab.input value to TabInputText.
 * Only text tabs (with a document URI) satisfy this guard; webviews, terminals,
 * notebooks, etc. do not.
 */
function isTabInputText(v: unknown): v is TabInputText {
  return (
    v !== null &&
    typeof v === "object" &&
    "uri" in v &&
    typeof (v as Record<string, unknown>)["uri"] === "object" &&
    (v as Record<string, unknown>)["uri"] !== null &&
    "fsPath" in ((v as Record<string, unknown>)["uri"] as Record<string, unknown>)
  );
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
  private vscode: VscodeApi;
  private send: StatePublisherSend;

  /** Current local snapshot of all IDE state fields — always up to date */
  private currentState: IDEState;

  /** Last state that was actually sent to Hub (for diff computation) */
  private sentState: IDEState | null = null;

  /** Active event listener disposables */
  private disposables: VsDisposable[] = [];

  /** Pending debounce timers keyed by category */
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Periodic keyframe timer handle */
  private keyframeTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param vscodeApi  Injected VSCode API (real or mocked)
   * @param sendFns    Callbacks to WsClient for outbound WS messages
   */
  constructor(vscodeApi: VscodeApi, sendFns: StatePublisherSend) {
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
    const initial = this.collectCurrentState();
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
        this.currentState.openEditors = this.deriveOpenEditors();
        this.scheduleFlush("tabs", TAB_DEBOUNCE_MS);
      }),
      this.vscode.window.tabGroups.onDidChangeTabs(() => {
        this.currentState.openEditors = this.deriveOpenEditors();
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

  // ── Internal: state collection ────────────────────────────────────────────

  /**
   * Collect the current IDE state directly from the VSCode API.
   * Used by start() for initial snapshot and by event handlers
   * to keep currentState fresh.
   */
  private collectCurrentState(): IDEState {
    const active = this.vscode.window.activeTextEditor;
    return {
      activeFile: active ? normalizePath(active.document.uri.fsPath) : null,
      activeFileLine: active ? active.selection.active.line + 1 : 1,
      activeFileColumn: active ? active.selection.active.character + 1 : 1,
      openEditors: this.deriveOpenEditors(),
      visibleEditors: Array.from(this.vscode.window.visibleTextEditors).map(
        (e) => normalizePath(e.document.uri.fsPath),
      ),
      workspaceFolders: (this.vscode.workspace.workspaceFolders ?? []).map(
        (f) => normalizePath(f.uri.fsPath),
      ),
      activeTerminal: this.vscode.window.activeTerminal?.name ?? null,
      workspaceName: this.vscode.workspace.name ?? null,
      remoteAuthority: this.vscode.env.remoteName ?? null,
      modalities: { ...this.currentState.modalities },
    };
  }

  /**
   * Derive openEditors list from vscode.window.tabGroups.all.
   * Only includes tabs with a TextDocument input (has .uri.fsPath).
   * Normalizes paths.
   *
   * §6.1: openEditors derived from tabGroups API, NOT workspace.onDidOpenTextDocument.
   */
  private deriveOpenEditors(): string[] {
    const seen = new Set<string>();
    for (const group of this.vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (isTabInputText(tab.input)) {
          seen.add(normalizePath(tab.input.uri.fsPath));
        }
      }
    }
    return Array.from(seen);
  }

  // ── Internal: diff + flush ────────────────────────────────────────────────

  /**
   * Compute the diff between currentState and sentState.
   * Returns only the fields that have changed, or null if nothing changed.
   *
   * §6.3: Arrays compared by value (JSON serialization).
   *        Scalars compared by strict equality.
   *        modalities compared per-key by JSON equality.
   */
  private computePatch(): Partial<IDEState> | null {
    const cur = this.currentState;
    const sent = this.sentState ?? StatePublisher.emptyState();
    const patch: Partial<IDEState> = {};

    if (cur.activeFile !== sent.activeFile) patch.activeFile = cur.activeFile;
    if (cur.activeFileLine !== sent.activeFileLine) patch.activeFileLine = cur.activeFileLine;
    if (cur.activeFileColumn !== sent.activeFileColumn) patch.activeFileColumn = cur.activeFileColumn;
    if (cur.activeTerminal !== sent.activeTerminal) patch.activeTerminal = cur.activeTerminal;
    if (cur.workspaceName !== sent.workspaceName) patch.workspaceName = cur.workspaceName;
    if (cur.remoteAuthority !== sent.remoteAuthority) patch.remoteAuthority = cur.remoteAuthority;

    if (JSON.stringify(cur.openEditors) !== JSON.stringify(sent.openEditors))
      patch.openEditors = cur.openEditors;
    if (JSON.stringify(cur.visibleEditors) !== JSON.stringify(sent.visibleEditors))
      patch.visibleEditors = cur.visibleEditors;
    if (JSON.stringify(cur.workspaceFolders) !== JSON.stringify(sent.workspaceFolders))
      patch.workspaceFolders = cur.workspaceFolders;
    if (JSON.stringify(cur.modalities) !== JSON.stringify(sent.modalities))
      patch.modalities = cur.modalities;

    return Object.keys(patch).length > 0 ? patch : null;
  }

  /**
   * If a patch exists, send it as a stateUpdate and update sentState.
   * Called by debounce timers.
   */
  private flushPatch(): void {
    const patch = this.computePatch();
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
    return {
      activeFile: null,
      activeFileLine: 1,
      activeFileColumn: 1,
      openEditors: [],
      visibleEditors: [],
      workspaceFolders: [],
      activeTerminal: null,
      workspaceName: null,
      remoteAuthority: null,
      modalities: {},
    };
  }
}

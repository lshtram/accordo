/**
 * Tests for state-publisher.ts
 * Requirements: requirements-bridge.md §6 (§6.1–§6.4)
 *
 * Phase C/D — implementation complete, all tests GREEN.
 *
 * Coverage:
 *   SP-NORM   normalizePath() utility
 *   §6.1      start() subscribes to all 7 VSCode events; events update local state
 *   §6.1-DEB  50ms debounce for editor/selection/terminal; 100ms for tabs;
 *             immediate for workspace folders
 *   §6.2      paths normalized to forward slashes
 *   §6.3      sendSnapshot() sends full state + resets sentState;
 *             debounced events send diffs; no message when nothing changed;
 *             keyframe timer fires every KEYFRAME_INTERVAL_MS
 *   §6.4      publishState() stores + immediately pushes modality stateUpdate;
 *             removeModalityState() removes + pushes modality patch
 *   getState  returns current local cache (no network)
 *   dispose   unsubscribes all events, cancels timers
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  StatePublisher,
  normalizePath,
  EDITOR_DEBOUNCE_MS,
  TAB_DEBOUNCE_MS,
  KEYFRAME_INTERVAL_MS,
} from "../state-publisher.js";
import type {
  VscodeApi,
  StatePublisherSend,
  TextEditor,
  TextEditorSelectionChangeEvent,
  Terminal,
  WorkspaceFoldersChangeEvent,
  VsDisposable,
} from "../state-publisher.js";
import type {
  StateSnapshotMessage,
  StateUpdateMessage,
} from "@accordo/bridge-types";
import { ACCORDO_PROTOCOL_VERSION } from "@accordo/bridge-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock TextEditor */
function makeEditor(fsPath: string, line = 0, character = 0): TextEditor {
  return {
    document: { uri: { fsPath } },
    selection: { active: { line, character } },
  };
}

/** Build a mock Terminal */
function makeTerminal(name: string): Terminal {
  return { name };
}

/**
 * Build a mock VscodeApi with controllable event emitters.
 * Returns the api object plus `emit*` helpers to fire events in tests.
 */
function makeMockVscode() {
  type Listener<T> = (e: T) => void;
  const listeners = {
    activeTextEditor: [] as Listener<TextEditor | undefined>[],
    visibleTextEditors: [] as Listener<readonly TextEditor[]>[],
    textEditorSelection: [] as Listener<TextEditorSelectionChangeEvent>[],
    activeTerminal: [] as Listener<Terminal | undefined>[],
    workspaceFolders: [] as Listener<WorkspaceFoldersChangeEvent>[],
    tabGroups: [] as Listener<unknown>[],
    tabs: [] as Listener<unknown>[],
  };

  function makeEvent<T>(store: Listener<T>[]): (l: Listener<T>) => VsDisposable {
    return (l) => {
      store.push(l);
      return { dispose: () => { const i = store.indexOf(l); if (i >= 0) store.splice(i, 1); } };
    };
  }

  const state = {
    activeTextEditor: undefined as TextEditor | undefined,
    visibleTextEditors: [] as TextEditor[],
    activeTerminal: undefined as Terminal | undefined,
    workspaceFolders: [] as Array<{ uri: { fsPath: string } }>,
    tabGroups: [] as Array<{ tabs: Array<{ label: string; isActive?: boolean; input?: unknown }> }>,
    workspaceName: undefined as string | undefined,
    remoteName: undefined as string | undefined,
  };

  const api: VscodeApi = {
    window: {
      get activeTextEditor() { return state.activeTextEditor; },
      get visibleTextEditors() { return state.visibleTextEditors; },
      get activeTerminal() { return state.activeTerminal; },
      onDidChangeActiveTextEditor: makeEvent(listeners.activeTextEditor),
      onDidChangeVisibleTextEditors: makeEvent(listeners.visibleTextEditors),
      onDidChangeTextEditorSelection: makeEvent(listeners.textEditorSelection),
      onDidChangeActiveTerminal: makeEvent(listeners.activeTerminal),
      tabGroups: {
        get all() { return state.tabGroups; },
        onDidChangeTabGroups: makeEvent(listeners.tabGroups),
        onDidChangeTabs: makeEvent(listeners.tabs),
      },
    },
    workspace: {
      get workspaceFolders() { return state.workspaceFolders; },
      get name() { return state.workspaceName; },
      onDidChangeWorkspaceFolders: makeEvent(listeners.workspaceFolders),
    },
    env: {
      get remoteName() { return state.remoteName; },
    },
  };

  return {
    api,
    state,
    emit: {
      activeTextEditor: (e: TextEditor | undefined) => listeners.activeTextEditor.forEach(l => l(e)),
      visibleTextEditors: (e: readonly TextEditor[]) => listeners.visibleTextEditors.forEach(l => l(e)),
      textEditorSelection: (e: TextEditorSelectionChangeEvent) => listeners.textEditorSelection.forEach(l => l(e)),
      activeTerminal: (e: Terminal | undefined) => listeners.activeTerminal.forEach(l => l(e)),
      workspaceFolders: (e: WorkspaceFoldersChangeEvent) => listeners.workspaceFolders.forEach(l => l(e)),
      tabGroups: (e: unknown) => listeners.tabGroups.forEach(l => l(e)),
      tabs: (e: unknown) => listeners.tabs.forEach(l => l(e)),
    },
    listenerCounts: () => ({
      activeTextEditor: listeners.activeTextEditor.length,
      visibleTextEditors: listeners.visibleTextEditors.length,
      textEditorSelection: listeners.textEditorSelection.length,
      activeTerminal: listeners.activeTerminal.length,
      workspaceFolders: listeners.workspaceFolders.length,
      tabGroups: listeners.tabGroups.length,
      tabs: listeners.tabs.length,
    }),
  };
}

/** Build a spy StatePublisherSend */
function makeSend() {
  const snapshots: StateSnapshotMessage[] = [];
  const updates: StateUpdateMessage[] = [];
  const send: StatePublisherSend = {
    sendSnapshot: vi.fn((m: StateSnapshotMessage) => snapshots.push(m)),
    sendUpdate: vi.fn((m: StateUpdateMessage) => updates.push(m)),
  };
  return { send, snapshots, updates };
}

// ── SP-NORM: normalizePath ────────────────────────────────────────────────────

describe("normalizePath", () => {
  it("SP-NORM-01: forward slashes passed through unchanged", () => {
    expect(normalizePath("/home/user/project/file.ts")).toBe("/home/user/project/file.ts");
  });

  it("SP-NORM-01: backslashes replaced with forward slashes (Windows paths)", () => {
    expect(normalizePath("C:\\Users\\user\\project\\file.ts")).toBe("C:/Users/user/project/file.ts");
  });

  it("SP-NORM-01: mixed slashes all converted to forward", () => {
    expect(normalizePath("C:\\Users/user\\file.ts")).toBe("C:/Users/user/file.ts");
  });

  it("SP-NORM-01: empty string unchanged", () => {
    expect(normalizePath("")).toBe("");
  });
});

// ── Main test suite ───────────────────────────────────────────────────────────

describe("StatePublisher", () => {
  let mock: ReturnType<typeof makeMockVscode>;
  let s: ReturnType<typeof makeSend>;
  let publisher: StatePublisher;

  beforeEach(() => {
    vi.useFakeTimers();
    mock = makeMockVscode();
    s = makeSend();
    publisher = new StatePublisher(mock.api, s.send);
  });

  afterEach(() => {
    publisher.dispose();
    vi.useRealTimers();
  });

  // ── §6.1: start() subscribes to all 7 VSCode events ────────────────────────

  describe("§6.1: start() subscribes to all VSCode events", () => {
    it("§6.1: registers a listener on onDidChangeActiveTextEditor", () => {
      publisher.start();
      expect(mock.listenerCounts().activeTextEditor).toBe(1);
    });

    it("§6.1: registers a listener on onDidChangeVisibleTextEditors", () => {
      publisher.start();
      expect(mock.listenerCounts().visibleTextEditors).toBe(1);
    });

    it("§6.1: registers a listener on onDidChangeTextEditorSelection", () => {
      publisher.start();
      expect(mock.listenerCounts().textEditorSelection).toBe(1);
    });

    it("§6.1: registers a listener on onDidChangeActiveTerminal", () => {
      publisher.start();
      expect(mock.listenerCounts().activeTerminal).toBe(1);
    });

    it("§6.1: registers a listener on onDidChangeWorkspaceFolders", () => {
      publisher.start();
      expect(mock.listenerCounts().workspaceFolders).toBe(1);
    });

    it("§6.1: registers a listener on onDidChangeTabGroups", () => {
      publisher.start();
      expect(mock.listenerCounts().tabGroups).toBe(1);
    });

    it("§6.1: registers a listener on onDidChangeTabs", () => {
      publisher.start();
      expect(mock.listenerCounts().tabs).toBe(1);
    });

    it("§6.1: captures activeFile from initial activeTextEditor on start()", () => {
      mock.state.activeTextEditor = makeEditor("/workspace/src/index.ts");
      publisher.start();
      expect(publisher.getState().activeFile).toBe("/workspace/src/index.ts");
    });

    it("§6.1: captures activeTerminal from initial activeTerminal on start()", () => {
      mock.state.activeTerminal = makeTerminal("bash");
      publisher.start();
      expect(publisher.getState().activeTerminal).toBe("bash");
    });

    it("§6.1: captures workspaceFolders from initial workspaceFolders on start()", () => {
      mock.state.workspaceFolders = [{ uri: { fsPath: "/workspace" } }];
      publisher.start();
      expect(publisher.getState().workspaceFolders).toEqual(["/workspace"]);
    });

    it("§6.1: captures openEditors from initial tabGroups on start()", () => {
      mock.state.tabGroups = [
        { tabs: [{ label: "", input: { uri: { fsPath: "/workspace/a.ts" } } }] },
      ];
      publisher.start();
      expect(publisher.getState().openEditors).toEqual(["/workspace/a.ts"]);
    });

    it("§6.1: does not send any messages during start()", () => {
      publisher.start();
      expect(s.send.sendSnapshot).not.toHaveBeenCalled();
      expect(s.send.sendUpdate).not.toHaveBeenCalled();
    });

    it("§6.1: captures workspaceName from vscode.workspace.name on start()", () => {
      mock.state.workspaceName = "my-project";
      publisher.start();
      expect(publisher.getState().workspaceName).toBe("my-project");
    });

    it("§6.1: workspaceName is null when vscode.workspace.name is undefined", () => {
      mock.state.workspaceName = undefined;
      publisher.start();
      expect(publisher.getState().workspaceName).toBeNull();
    });

    it("§6.1: captures remoteAuthority from vscode.env.remoteName on start()", () => {
      mock.state.remoteName = "ssh-remote";
      publisher.start();
      expect(publisher.getState().remoteAuthority).toBe("ssh-remote");
    });

    it("§6.1: remoteAuthority is null when vscode.env.remoteName is undefined", () => {
      mock.state.remoteName = undefined;
      publisher.start();
      expect(publisher.getState().remoteAuthority).toBeNull();
    });
  });

  // ── §6.1: event → local state updates ──────────────────────────────────────

  describe("§6.1: VSCode events update local state", () => {
    beforeEach(() => { publisher.start(); });

    it("§6.1: onDidChangeActiveTextEditor updates activeFile", () => {
      mock.emit.activeTextEditor(makeEditor("/workspace/new.ts"));
      expect(publisher.getState().activeFile).toBe("/workspace/new.ts");
    });

    it("§6.1: onDidChangeActiveTextEditor to undefined sets activeFile null", () => {
      mock.emit.activeTextEditor(makeEditor("/workspace/a.ts"));
      mock.emit.activeTextEditor(undefined);
      expect(publisher.getState().activeFile).toBeNull();
    });

    it("§6.1: onDidChangeActiveTextEditor updates activeFileLine (1-based)", () => {
      mock.emit.activeTextEditor(makeEditor("/f.ts", 4, 0)); // 0-based → line 5
      expect(publisher.getState().activeFileLine).toBe(5);
    });

    it("§6.1: onDidChangeActiveTextEditor updates activeFileColumn (1-based)", () => {
      mock.emit.activeTextEditor(makeEditor("/f.ts", 0, 7)); // 0-based → col 8
      expect(publisher.getState().activeFileColumn).toBe(8);
    });

    it("§6.1: onDidChangeTextEditorSelection updates line + column", () => {
      mock.emit.activeTextEditor(makeEditor("/f.ts"));
      mock.emit.textEditorSelection({
        textEditor: makeEditor("/f.ts", 9, 3),
      });
      expect(publisher.getState().activeFileLine).toBe(10);
      expect(publisher.getState().activeFileColumn).toBe(4);
    });

    it("§6.1: onDidChangeVisibleTextEditors updates visibleEditors", () => {
      mock.state.visibleTextEditors = [makeEditor("/a.ts"), makeEditor("/b.ts")];
      mock.emit.visibleTextEditors([makeEditor("/a.ts"), makeEditor("/b.ts")]);
      expect(publisher.getState().visibleEditors).toEqual(["/a.ts", "/b.ts"]);
    });

    it("§6.1: onDidChangeActiveTerminal updates activeTerminal", () => {
      mock.emit.activeTerminal(makeTerminal("zsh"));
      expect(publisher.getState().activeTerminal).toBe("zsh");
    });

    it("§6.1: onDidChangeActiveTerminal to undefined sets activeTerminal null", () => {
      mock.emit.activeTerminal(makeTerminal("zsh"));
      mock.emit.activeTerminal(undefined);
      expect(publisher.getState().activeTerminal).toBeNull();
    });

    it("§6.1: onDidChangeWorkspaceFolders updates workspaceFolders", () => {
      const event: WorkspaceFoldersChangeEvent = {
        added: [{ uri: { fsPath: "/newRoot" } }],
        removed: [],
      };
      mock.state.workspaceFolders = [{ uri: { fsPath: "/newRoot" } }];
      mock.emit.workspaceFolders(event);
      expect(publisher.getState().workspaceFolders).toEqual(["/newRoot"]);
    });

    it("§6.1: onDidChangeTabGroups updates openEditors (re-derives from tabGroups.all)", () => {
      mock.state.tabGroups = [
        { tabs: [{ label: "", input: { uri: { fsPath: "/a.ts" } } }, { label: "", input: { uri: { fsPath: "/b.ts" } } }] },
      ];
      mock.emit.tabGroups({});
      expect(publisher.getState().openEditors).toEqual(["/a.ts", "/b.ts"]);
    });

    it("§6.1: onDidChangeTabs updates openEditors", () => {
      mock.state.tabGroups = [
        { tabs: [{ label: "", input: { uri: { fsPath: "/c.ts" } } }] },
      ];
      mock.emit.tabs({});
      expect(publisher.getState().openEditors).toEqual(["/c.ts"]);
    });

    it("§6.1: openEditors ignores tabs without a URI input (webviews etc.)", () => {
      mock.state.tabGroups = [
        { tabs: [
          { label: "", input: { uri: { fsPath: "/real.ts" } } },
          { label: "", input: undefined },     // unknown input
          { label: "" },                        // no input at all
        ]},
      ];
      mock.emit.tabGroups({});
      expect(publisher.getState().openEditors).toEqual(["/real.ts"]);
    });

    it("§6.1: selection event from non-active editor does not update activeFileLine/Column", () => {
      // Set active editor to /active.ts at line 3, col 3 (0-based: 2, 2)
      mock.emit.activeTextEditor(makeEditor("/active.ts", 2, 2));
      // VSCode fires a selection event for a non-active editor (e.g. peek, diff)
      mock.emit.textEditorSelection({ textEditor: makeEditor("/other.ts", 9, 9) });
      // activeFileLine/Column must still reflect /active.ts cursor, not /other.ts
      expect(publisher.getState().activeFile).toBe("/active.ts");
      expect(publisher.getState().activeFileLine).toBe(3);
      expect(publisher.getState().activeFileColumn).toBe(3);
    });
  });

  // ── §6.2: path normalization ────────────────────────────────────────────────

  describe("§6.2: path normalization in IDEState", () => {
    beforeEach(() => { publisher.start(); });

    it("§6.2: activeFile stored with forward slashes", () => {
      mock.emit.activeTextEditor(makeEditor("C:\\Users\\user\\file.ts"));
      expect(publisher.getState().activeFile).toBe("C:/Users/user/file.ts");
    });

    it("§6.2: visibleEditors stored with forward slashes", () => {
      mock.state.visibleTextEditors = [makeEditor("C:\\a\\b.ts")];
      mock.emit.visibleTextEditors([makeEditor("C:\\a\\b.ts")]);
      expect(publisher.getState().visibleEditors).toEqual(["C:/a/b.ts"]);
    });

    it("§6.2: openEditors stored with forward slashes", () => {
      mock.state.tabGroups = [{ tabs: [{ label: "", input: { uri: { fsPath: "C:\\proj\\main.ts" } } }] }];
      mock.emit.tabGroups({});
      expect(publisher.getState().openEditors).toEqual(["C:/proj/main.ts"]);
    });

    it("§6.2: workspaceFolders stored with forward slashes", () => {
      mock.state.workspaceFolders = [{ uri: { fsPath: "C:\\workspace" } }];
      mock.emit.workspaceFolders({ added: [], removed: [] });
      expect(publisher.getState().workspaceFolders).toEqual(["C:/workspace"]);
    });
  });

  // ── §6.3: debounce — editor events (50ms) ──────────────────────────────────

  describe("§6.3: editor events debounce 50ms before sending stateUpdate", () => {
    beforeEach(() => {
      publisher.start();
      publisher.sendSnapshot(); // sets sentState so diffs can be computed
    });

    it("§6.3: onDidChangeActiveTextEditor does not send immediately", () => {
      const callsBefore = (s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls.length;
      mock.emit.activeTextEditor(makeEditor("/new.ts"));
      expect((s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
    });

    it("§6.3: onDidChangeActiveTextEditor sends stateUpdate after 50ms", () => {
      mock.emit.activeTextEditor(makeEditor("/new.ts"));
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      expect(s.send.sendUpdate).toHaveBeenCalled();
    });

    it("§6.3: rapid active-editor events coalesced into one stateUpdate", () => {
      mock.emit.activeTextEditor(makeEditor("/a.ts"));
      vi.advanceTimersByTime(20);
      mock.emit.activeTextEditor(makeEditor("/b.ts"));
      vi.advanceTimersByTime(20);
      mock.emit.activeTextEditor(makeEditor("/c.ts"));
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      // only one update, containing /c.ts
      const updateCalls = (s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls;
      expect(updateCalls.length).toBe(1);
      expect(updateCalls[0][0].patch.activeFile).toBe("/c.ts");
    });

    it("§6.3: onDidChangeTextEditorSelection debounces at 50ms", () => {
      // Activate the file first so the active-editor guard allows the selection event
      mock.emit.activeTextEditor(makeEditor("/f.ts"));
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS); // flush the editor-change update
      (s.send.sendUpdate as ReturnType<typeof vi.fn>).mockClear();

      mock.emit.textEditorSelection({ textEditor: makeEditor("/f.ts", 5, 0) });
      expect(s.send.sendUpdate).not.toHaveBeenCalled();
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      expect(s.send.sendUpdate).toHaveBeenCalled();
    });

    it("§6.3: onDidChangeActiveTerminal debounces at 50ms", () => {
      mock.emit.activeTerminal(makeTerminal("fish"));
      expect(s.send.sendUpdate).not.toHaveBeenCalled();
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      expect(s.send.sendUpdate).toHaveBeenCalled();
    });

    it("§6.3: onDidChangeVisibleTextEditors debounces at 50ms", () => {
      mock.state.visibleTextEditors = [makeEditor("/x.ts")];
      mock.emit.visibleTextEditors([makeEditor("/x.ts")]);
      expect(s.send.sendUpdate).not.toHaveBeenCalled();
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      expect(s.send.sendUpdate).toHaveBeenCalled();
    });
  });

  // ── §6.3: debounce — tab events (100ms) ────────────────────────────────────

  describe("§6.3: tab events debounce 100ms before sending stateUpdate", () => {
    beforeEach(() => {
      publisher.start();
      publisher.sendSnapshot();
    });

    it("§6.3: onDidChangeTabGroups does not send immediately", () => {
      mock.state.tabGroups = [{ tabs: [{ label: "", input: { uri: { fsPath: "/a.ts" } } }] }];
      mock.emit.tabGroups({});
      expect(s.send.sendUpdate).not.toHaveBeenCalled();
    });

    it("§6.3: onDidChangeTabGroups sends after 100ms", () => {
      mock.state.tabGroups = [{ tabs: [{ label: "", input: { uri: { fsPath: "/a.ts" } } }] }];
      mock.emit.tabGroups({});
      vi.advanceTimersByTime(TAB_DEBOUNCE_MS);
      expect(s.send.sendUpdate).toHaveBeenCalled();
    });

    it("§6.3: onDidChangeTabs sends after 100ms", () => {
      mock.state.tabGroups = [{ tabs: [{ label: "", input: { uri: { fsPath: "/b.ts" } } }] }];
      mock.emit.tabs({});
      vi.advanceTimersByTime(TAB_DEBOUNCE_MS);
      expect(s.send.sendUpdate).toHaveBeenCalled();
    });

    it("§6.3: tab events NOT triggered by 50ms timer (need full 100ms)", () => {
      mock.state.tabGroups = [{ tabs: [{ label: "", input: { uri: { fsPath: "/a.ts" } } }] }];
      mock.emit.tabGroups({});
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      expect(s.send.sendUpdate).not.toHaveBeenCalled();
    });
  });

  // ── §6.2: multi-root workspace support ────────────────────────────────────

  describe("§6.2: multi-root workspace — multiple workspaceFolders captured", () => {
    it("§6.2: start() captures all roots when multiple workspace folders are open", () => {
      mock.state.workspaceFolders = [
        { uri: { fsPath: "/root-a" } },
        { uri: { fsPath: "/root-b" } },
        { uri: { fsPath: "/root-c" } },
      ];
      publisher.start();
      expect(publisher.getState().workspaceFolders).toEqual(["/root-a", "/root-b", "/root-c"]);
    });

    it("§6.2: workspace folder order preserved from VSCode's folder order", () => {
      mock.state.workspaceFolders = [
        { uri: { fsPath: "/z-root" } },
        { uri: { fsPath: "/a-root" } },
      ];
      publisher.start();
      // must preserve VSCode order, not sort alphabetically
      expect(publisher.getState().workspaceFolders[0]).toBe("/z-root");
      expect(publisher.getState().workspaceFolders[1]).toBe("/a-root");
    });

    it("§6.2: workspace folder event with multiple added roots updates all of them", () => {
      publisher.start();
      publisher.sendSnapshot();
      mock.state.workspaceFolders = [
        { uri: { fsPath: "/root-1" } },
        { uri: { fsPath: "/root-2" } },
      ];
      mock.emit.workspaceFolders({ added: [], removed: [] });
      expect(publisher.getState().workspaceFolders).toEqual(["/root-1", "/root-2"]);
    });

    it("§6.2: workspaceFolders empty array when no folders open", () => {
      mock.state.workspaceFolders = [];
      publisher.start();
      expect(publisher.getState().workspaceFolders).toEqual([]);
    });
  });

  // ── §6.1: openEditors deduplication ──────────────────────────────────────

  describe("§6.1: openEditors deduplication — same file in multiple tab groups", () => {
    beforeEach(() => { publisher.start(); });

    it("§6.1: same file appearing in two tab groups is listed only once", () => {
      mock.state.tabGroups = [
        { tabs: [{ label: "", input: { uri: { fsPath: "/shared.ts" } } }] },
        { tabs: [{ label: "", input: { uri: { fsPath: "/shared.ts" } } }] },
      ];
      mock.emit.tabGroups({});
      expect(publisher.getState().openEditors).toEqual(["/shared.ts"]);
      expect(publisher.getState().openEditors).toHaveLength(1);
    });

    it("§6.1: tabs across multiple groups are all included (when unique)", () => {
      mock.state.tabGroups = [
        { tabs: [{ label: "", input: { uri: { fsPath: "/a.ts" } } }] },
        { tabs: [{ label: "", input: { uri: { fsPath: "/b.ts" } } }] },
      ];
      mock.emit.tabGroups({});
      expect(publisher.getState().openEditors).toHaveLength(2);
      expect(publisher.getState().openEditors).toContain("/a.ts");
      expect(publisher.getState().openEditors).toContain("/b.ts");
    });
  });

  // ── §6.3: workspace folder changes are immediate ────────────────────────────

  describe("§6.3: workspace folder changes send immediately (no debounce)", () => {
    beforeEach(() => {
      publisher.start();
      publisher.sendSnapshot();
    });

    it("§6.3: onDidChangeWorkspaceFolders sends stateUpdate without waiting", () => {
      mock.state.workspaceFolders = [{ uri: { fsPath: "/newRoot" } }];
      mock.emit.workspaceFolders({ added: [{ uri: { fsPath: "/newRoot" } }], removed: [] });
      expect(s.send.sendUpdate).toHaveBeenCalledOnce();
    });

    it("§6.3: immediate update contains the new workspaceFolders value", () => {
      mock.state.workspaceFolders = [{ uri: { fsPath: "/root1" } }, { uri: { fsPath: "/root2" } }];
      mock.emit.workspaceFolders({ added: [], removed: [] });
      const msg = (s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as StateUpdateMessage;
      expect(msg.patch.workspaceFolders).toEqual(["/root1", "/root2"]);
    });
  });

  // ── §6.3: patch contents — only changed fields ──────────────────────────────

  describe("§6.3: stateUpdate includes only changed fields", () => {
    beforeEach(() => {
      publisher.start();
      publisher.sendSnapshot();
    });

    it("§6.3: patch contains activeFile when it changed", () => {
      mock.emit.activeTextEditor(makeEditor("/changed.ts"));
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      const msg = (s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as StateUpdateMessage;
      expect(msg.patch).toHaveProperty("activeFile", "/changed.ts");
    });

    it("§6.3: patch does NOT contain fields that did not change", () => {
      mock.emit.activeTextEditor(makeEditor("/changed.ts"));
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      const msg = (s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as StateUpdateMessage;
      expect(msg.patch).not.toHaveProperty("workspaceFolders");
      expect(msg.patch).not.toHaveProperty("openEditors");
    });

    it("§6.3: no stateUpdate sent if active editor changes to same file", () => {
      mock.emit.activeTextEditor(makeEditor("/same.ts"));
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS); // first change sends
      const countAfterFirst = (s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls.length;
      // change to same path again
      mock.emit.activeTextEditor(makeEditor("/same.ts"));
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      expect((s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(countAfterFirst);
    });

    it("§6.3: stateUpdate message type is 'stateUpdate'", () => {
      mock.emit.activeTerminal(makeTerminal("bash"));
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      const msg = (s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as StateUpdateMessage;
      expect(msg.type).toBe("stateUpdate");
    });
  });

  // ── §6.3: sendSnapshot ───────────────────────────────────────────────────────

  describe("§6.3: sendSnapshot()", () => {
    it("§6.3: sends a stateSnapshot message", () => {
      publisher.start();
      publisher.sendSnapshot();
      expect(s.send.sendSnapshot).toHaveBeenCalledOnce();
    });

    it("§6.3: snapshot type is 'stateSnapshot'", () => {
      publisher.start();
      publisher.sendSnapshot();
      const msg = s.snapshots[0];
      expect(msg.type).toBe("stateSnapshot");
    });

    it("§6.3: snapshot includes protocolVersion", () => {
      publisher.start();
      publisher.sendSnapshot();
      expect(s.snapshots[0].protocolVersion).toBe(ACCORDO_PROTOCOL_VERSION);
    });

    it("§6.3: snapshot state matches current getState()", () => {
      mock.state.activeTerminal = makeTerminal("zsh");
      mock.state.workspaceFolders = [{ uri: { fsPath: "/root" } }];
      publisher.start();
      publisher.sendSnapshot();
      expect(s.snapshots[0].state).toEqual(publisher.getState());
    });

    it("§6.3: after sendSnapshot, a subsequent unchanged event sends no stateUpdate", () => {
      publisher.start();
      mock.emit.activeTextEditor(makeEditor("/f.ts"));
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS); // sends diff #1
      publisher.sendSnapshot(); // resets sentState
      // same state — no change since snapshot
      mock.emit.activeTextEditor(makeEditor("/f.ts")); // same path
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      // only 1 update (the first diff), snapshot does not count as sendUpdate
      expect((s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });

    it("§6.3: after sendSnapshot, a changed event does send stateUpdate", () => {
      publisher.start();
      publisher.sendSnapshot();
      mock.emit.activeTextEditor(makeEditor("/different.ts"));
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS);
      expect(s.send.sendUpdate).toHaveBeenCalled();
    });
  });

  // ── §6.3: keyframe timer ─────────────────────────────────────────────────────

  describe("§6.3: keyframe timer sends full snapshot every KEYFRAME_INTERVAL_MS", () => {
    it("§6.3: no keyframe before interval elapses", () => {
      publisher.start();
      vi.advanceTimersByTime(KEYFRAME_INTERVAL_MS - 1);
      expect(s.send.sendSnapshot).not.toHaveBeenCalled();
    });

    it("§6.3: snapshot sent when keyframe interval fires", () => {
      publisher.start();
      vi.advanceTimersByTime(KEYFRAME_INTERVAL_MS);
      expect(s.send.sendSnapshot).toHaveBeenCalledOnce();
    });

    it("§6.3: keyframe repeats — two snapshots after 2× interval", () => {
      publisher.start();
      vi.advanceTimersByTime(KEYFRAME_INTERVAL_MS * 2);
      expect(s.send.sendSnapshot).toHaveBeenCalledTimes(2);
    });

    it("§6.3: keyframe snapshot has type stateSnapshot and protocolVersion", () => {
      publisher.start();
      vi.advanceTimersByTime(KEYFRAME_INTERVAL_MS);
      const msg = s.snapshots[0];
      expect(msg.type).toBe("stateSnapshot");
      expect(msg.protocolVersion).toBe(ACCORDO_PROTOCOL_VERSION);
    });

    it("§6.3: dispose() stops keyframe timer", () => {
      publisher.start();
      publisher.dispose();
      vi.advanceTimersByTime(KEYFRAME_INTERVAL_MS * 3);
      expect(s.send.sendSnapshot).not.toHaveBeenCalled();
    });
  });

  // ── §6.4: modality state ─────────────────────────────────────────────────────

  describe("§6.4: modality state", () => {
    beforeEach(() => { publisher.start(); });

    it("§6.4: publishState() stores state in getState().modalities", () => {
      publisher.publishState("accordo-editor", { openFiles: 3 });
      expect(publisher.getState().modalities["accordo-editor"]).toEqual({ openFiles: 3 });
    });

    it("§6.4: publishState() immediately sends stateUpdate (no debounce)", () => {
      publisher.publishState("accordo-editor", { openFiles: 5 });
      expect(s.send.sendUpdate).toHaveBeenCalledOnce();
    });

    it("§6.4: publishState() stateUpdate contains only modalities patch", () => {
      publisher.publishState("my-ext", { count: 1 });
      const msg = (s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as StateUpdateMessage;
      expect(msg.type).toBe("stateUpdate");
      expect(msg.patch).toEqual({ modalities: { "my-ext": { count: 1 } } });
    });

    it("§6.4: publishState() overwrites previous state for same extensionId", () => {
      publisher.publishState("ext", { v: 1 });
      publisher.publishState("ext", { v: 2 });
      expect(publisher.getState().modalities["ext"]).toEqual({ v: 2 });
    });

    it("§6.4: publishState() for different extensions stores both", () => {
      publisher.publishState("ext-a", { a: true });
      publisher.publishState("ext-b", { b: true });
      expect(publisher.getState().modalities["ext-a"]).toEqual({ a: true });
      expect(publisher.getState().modalities["ext-b"]).toEqual({ b: true });
    });

    it("§6.4: removeModalityState() removes key from getState().modalities", () => {
      publisher.publishState("ext", { x: 1 });
      publisher.removeModalityState("ext");
      expect(publisher.getState().modalities).not.toHaveProperty("ext");
    });

    it("§6.4: removeModalityState() sends stateUpdate with removed key", () => {
      publisher.publishState("ext", { x: 1 });
      (s.send.sendUpdate as ReturnType<typeof vi.fn>).mockClear();
      publisher.removeModalityState("ext");
      expect(s.send.sendUpdate).toHaveBeenCalledOnce();
    });

    it("§6.4: removeModalityState() patch contains modalities key with removed extensionId absent", () => {
      publisher.publishState("ext-a", { v: 1 });
      publisher.publishState("ext-b", { v: 2 });
      (s.send.sendUpdate as ReturnType<typeof vi.fn>).mockClear();
      publisher.removeModalityState("ext-a");
      const msg = (s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0] as StateUpdateMessage;
      expect(msg.type).toBe("stateUpdate");
      // patch must reference modalities and the removed key must not be present in local state
      expect(msg.patch).toHaveProperty("modalities");
      expect(publisher.getState().modalities).not.toHaveProperty("ext-a");
      expect(publisher.getState().modalities).toHaveProperty("ext-b");
    });

    it("§6.4: removeModalityState() on non-existent key sends no update", () => {
      publisher.removeModalityState("unknown-ext");
      expect(s.send.sendUpdate).not.toHaveBeenCalled();
    });
  });

  // ── getState() ────────────────────────────────────────────────────────────────

  describe("getState()", () => {
    it("getState(): returns empty state before start()", () => {
      const state = publisher.getState();
      expect(state.activeFile).toBeNull();
      expect(state.openEditors).toEqual([]);
      expect(state.workspaceFolders).toEqual([]);
      expect(state.modalities).toEqual({});
    });

    it("getState(): returns current state after events", () => {
      publisher.start();
      mock.emit.activeTextEditor(makeEditor("/live.ts"));
      expect(publisher.getState().activeFile).toBe("/live.ts");
    });

    it("getState(): returns line 1 / column 1 when no editor open", () => {
      publisher.start();
      expect(publisher.getState().activeFileLine).toBe(1);
      expect(publisher.getState().activeFileColumn).toBe(1);
    });
  });

  // ── dispose() ─────────────────────────────────────────────────────────────────

  describe("dispose()", () => {
    it("dispose(): removes all VSCode event listeners", () => {
      publisher.start();
      publisher.dispose();
      // all listener arrays should be empty
      const counts = mock.listenerCounts();
      expect(Object.values(counts).every(c => c === 0)).toBe(true);
    });

    it("dispose(): cancels pending debounce timers (no stateUpdate after dispose)", () => {
      publisher.start();
      publisher.sendSnapshot();
      mock.emit.activeTextEditor(makeEditor("/pending.ts"));
      publisher.dispose();
      vi.advanceTimersByTime(EDITOR_DEBOUNCE_MS * 10);
      expect(s.send.sendUpdate).not.toHaveBeenCalled();
    });

    it("dispose(): is idempotent — second call does not throw", () => {
      publisher.start();
      publisher.dispose();
      expect(() => publisher.dispose()).not.toThrow();
    });

    it("dispose(): events after dispose do not update local state", () => {
      publisher.start();
      publisher.dispose();
      mock.emit.activeTextEditor(makeEditor("/after-dispose.ts"));
      // state should remain as it was before dispose (activeFile null in this case)
      expect(publisher.getState().activeFile).toBeNull();
    });
  });

  // ── Constants ────────────────────────────────────────────────────────────────

  describe("exported constants", () => {
    it("EDITOR_DEBOUNCE_MS is 50", () => {
      expect(EDITOR_DEBOUNCE_MS).toBe(50);
    });

    it("TAB_DEBOUNCE_MS is 100", () => {
      expect(TAB_DEBOUNCE_MS).toBe(100);
    });

    it("KEYFRAME_INTERVAL_MS is 600000", () => {
      expect(KEYFRAME_INTERVAL_MS).toBe(600_000);
    });
  });

  // ── §6.5 M74-OT: openTabs capture ────────────────────────────────────────────

  describe("§6.5 M74-OT: openTabs capture", () => {
    // M74-OT-02: openTabs defaults to [] in emptyState()
    it("M74-OT-02: StatePublisher.emptyState() includes openTabs: []", () => {
      const state = StatePublisher.emptyState();
      expect(state).toHaveProperty("openTabs");
      expect(state.openTabs).toEqual([]);
    });

    // M74-OT-05: text tab → type: "text", path
    it("M74-OT-05: text tab produces type 'text' entry with normalized path", () => {
      mock.state.tabGroups = [
        {
          tabs: [
            {
              label: "server.ts",
              isActive: true,
              input: { uri: { fsPath: "/workspace/server.ts" } },
            },
          ],
        },
      ];
      publisher.start();
      const tabs = publisher.getState().openTabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toMatchObject({
        label: "server.ts",
        type: "text",
        path: "/workspace/server.ts",
        isActive: true,
        groupIndex: 0,
      });
    });

    // M74-OT-05: webview tab → type: "webview", viewType
    it("M74-OT-05: webview tab produces type 'webview' entry with viewType", () => {
      mock.state.tabGroups = [
        {
          tabs: [
            {
              label: "arch.mmd",
              isActive: false,
              input: { viewType: "accordo.diagram" },
            },
          ],
        },
      ];
      publisher.start();
      const tabs = publisher.getState().openTabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toMatchObject({
        label: "arch.mmd",
        type: "webview",
        viewType: "accordo.diagram",
        isActive: false,
        groupIndex: 0,
      });
      expect(tabs[0]).not.toHaveProperty("path");
    });

    // M74-OT-05: other tab → type: "other"
    it("M74-OT-05: unknown input type produces type 'other' entry", () => {
      mock.state.tabGroups = [
        {
          tabs: [
            {
              label: "[Terminal 1]",
              isActive: false,
              input: undefined,
            },
          ],
        },
      ];
      publisher.start();
      const tabs = publisher.getState().openTabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toMatchObject({
        label: "[Terminal 1]",
        type: "other",
        isActive: false,
        groupIndex: 0,
      });
      expect(tabs[0]).not.toHaveProperty("path");
      expect(tabs[0]).not.toHaveProperty("viewType");
    });

    // M74-OT-06: isActive taken from tab.isActive, not path comparison
    it("M74-OT-06: isActive comes from tab.isActive, not path comparison", () => {
      // Two groups — same file, but isActive only on second
      mock.state.tabGroups = [
        {
          tabs: [
            {
              label: "shared.ts",
              isActive: false,
              input: { uri: { fsPath: "/shared.ts" } },
            },
          ],
        },
        {
          tabs: [
            {
              label: "shared.ts",
              isActive: true,
              input: { uri: { fsPath: "/shared.ts" } },
            },
          ],
        },
      ];
      publisher.start();
      const tabs = publisher.getState().openTabs;
      expect(tabs[0].isActive).toBe(false);
      expect(tabs[1].isActive).toBe(true);
    });

    // M74-OT-06: undefined isActive → false (not an error)
    it("M74-OT-06: tab.isActive undefined falls back to false", () => {
      mock.state.tabGroups = [
        {
          tabs: [
            {
              label: "noactive.ts",
              // isActive deliberately omitted
              input: { uri: { fsPath: "/noactive.ts" } },
            },
          ],
        },
      ];
      publisher.start();
      const tabs = publisher.getState().openTabs;
      expect(tabs[0].isActive).toBe(false);
    });

    // M74-OT-07: groupIndex is 0-based index of the tab's group
    it("M74-OT-07: groupIndex reflects position of group in tabGroups.all", () => {
      mock.state.tabGroups = [
        {
          tabs: [
            { label: "a.ts", isActive: false, input: { uri: { fsPath: "/a.ts" } } },
          ],
        },
        {
          tabs: [
            { label: "b.ts", isActive: false, input: { uri: { viewType: "accordo.presentation" } } },
          ],
        },
        {
          tabs: [
            { label: "c.ts", isActive: false, input: undefined },
          ],
        },
      ];
      publisher.start();
      const tabs = publisher.getState().openTabs;
      expect(tabs[0].groupIndex).toBe(0);
      expect(tabs[1].groupIndex).toBe(1);
      expect(tabs[2].groupIndex).toBe(2);
    });

    // M74-OT-08: collectCurrentState includes openTabs
    it("M74-OT-08: getState() includes openTabs after start()", () => {
      mock.state.tabGroups = [];
      publisher.start();
      expect(publisher.getState()).toHaveProperty("openTabs");
      expect(Array.isArray(publisher.getState().openTabs)).toBe(true);
    });

    // M74-OT-09: onDidChangeTabGroups updates openTabs (same 100ms debounce)
    it("M74-OT-09: onDidChangeTabGroups updates openTabs on tab event", () => {
      publisher.start();
      mock.state.tabGroups = [
        {
          tabs: [
            { label: "new.ts", isActive: true, input: { uri: { fsPath: "/new.ts" } } },
          ],
        },
      ];
      mock.emit.tabGroups({});
      expect(publisher.getState().openTabs).toHaveLength(1);
      expect(publisher.getState().openTabs[0].label).toBe("new.ts");
    });

    it("M74-OT-09: onDidChangeTabs updates openTabs on tab event", () => {
      publisher.start();
      mock.state.tabGroups = [
        {
          tabs: [
            { label: "diagram.mmd", isActive: false, input: { viewType: "accordo.diagram" } },
          ],
        },
      ];
      mock.emit.tabs({});
      const tab = publisher.getState().openTabs[0];
      expect(tab.type).toBe("webview");
      expect(tab.viewType).toBe("accordo.diagram");
    });

    // M74-OT-10: computePatch diffs openTabs by JSON equality
    it("M74-OT-10: stateUpdate patch includes openTabs when openTabs changes", () => {
      publisher.start();
      publisher.sendSnapshot();

      mock.state.tabGroups = [
        {
          tabs: [
            { label: "new.ts", isActive: true, input: { uri: { fsPath: "/new.ts" } } },
          ],
        },
      ];
      mock.emit.tabs({});
      vi.advanceTimersByTime(TAB_DEBOUNCE_MS);

      const calls = (s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const msg = calls[calls.length - 1][0] as StateUpdateMessage;
      expect(msg.patch).toHaveProperty("openTabs");
      expect(msg.patch.openTabs).toHaveLength(1);
    });

    it("M74-OT-10: stateUpdate patch does NOT include openTabs when openTabs unchanged", () => {
      mock.state.tabGroups = [
        {
          tabs: [
            { label: "same.ts", isActive: false, input: { uri: { fsPath: "/same.ts" } } },
          ],
        },
      ];
      publisher.start();
      publisher.sendSnapshot();

      // Emit tab event but tabGroups state is identical
      mock.emit.tabs({});
      vi.advanceTimersByTime(TAB_DEBOUNCE_MS);

      const calls = (s.send.sendUpdate as ReturnType<typeof vi.fn>).mock.calls;
      for (const [msg] of calls) {
        expect((msg as StateUpdateMessage).patch).not.toHaveProperty("openTabs");
      }
    });

    // M74-OT-05: mixed tab types in single snapshot
    it("M74-OT-05: mixed text + webview + other tabs all captured in one snapshot", () => {
      mock.state.tabGroups = [
        {
          tabs: [
            { label: "server.ts",  isActive: true,  input: { uri: { fsPath: "/server.ts" } } },
            { label: "arch.mmd",   isActive: false, input: { viewType: "accordo.diagram" } },
            { label: "[Terminal]", isActive: false, input: undefined },
          ],
        },
      ];
      publisher.start();
      const tabs = publisher.getState().openTabs;
      expect(tabs).toHaveLength(3);
      expect(tabs.map((t) => t.type)).toEqual(["text", "webview", "other"]);
    });

    // M74-OT-05: path normalized (forward slashes)
    it("M74-OT-05: text tab path is normalized to forward slashes", () => {
      mock.state.tabGroups = [
        {
          tabs: [
            { label: "file.ts", isActive: false, input: { uri: { fsPath: "C:\\Users\\user\\file.ts" } } },
          ],
        },
      ];
      publisher.start();
      const tabs = publisher.getState().openTabs;
      expect(tabs[0].path).toBe("C:/Users/user/file.ts");
    });
  });
});

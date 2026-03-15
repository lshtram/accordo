/**
 * Tests for state-cache.ts
 * Requirements: requirements-hub.md §5.2
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { IDEState } from "@accordo/bridge-types";
import { StateCache, createEmptyState } from "../state-cache.js";

// ── createEmptyState ──────────────────────────────────────────────────────────

describe("createEmptyState", () => {
  it("§5.2: createEmptyState returns null activeFile", () => {
    expect(createEmptyState().activeFile).toBeNull();
  });

  it("§5.2: createEmptyState has cursor at line 1, column 1", () => {
    const s = createEmptyState();
    expect(s.activeFileLine).toBe(1);
    expect(s.activeFileColumn).toBe(1);
  });

  it("§5.2: createEmptyState has empty editors and workspace folders", () => {
    const s = createEmptyState();
    expect(s.openEditors).toEqual([]);
    expect(s.visibleEditors).toEqual([]);
    expect(s.workspaceFolders).toEqual([]);
  });

  it("§5.2: createEmptyState has null activeTerminal", () => {
    expect(createEmptyState().activeTerminal).toBeNull();
  });

  it("§5.2: createEmptyState has empty modalities object", () => {
    expect(createEmptyState().modalities).toEqual({});
  });
});

// ── StateCache ────────────────────────────────────────────────────────────────

describe("StateCache", () => {
  let cache: StateCache;

  beforeEach(() => {
    cache = new StateCache();
  });

  // ── getState ──────────────────────────────────────────────────────────────

  describe("getState", () => {
    it("§5.2: getState matches createEmptyState on new instance", () => {
      expect(cache.getState()).toEqual(createEmptyState());
    });

    it("§5.2: getState returns a deep copy — mutations do not affect the cache", () => {
      // req-hub §5.2: callers must not be able to corrupt the cache via the returned ref
      const state = cache.getState();
      state.openEditors.push("/some/file.ts");
      expect(cache.getState().openEditors).toEqual([]);
    });
  });

  // ── applyPatch ────────────────────────────────────────────────────────────

  describe("applyPatch", () => {
    it("§5.2: applyPatch updates only specified fields", () => {
      // req-hub §5.2: Merge patch into current state
      cache.applyPatch({ activeFile: "/workspace/foo.ts" });
      const state = cache.getState();
      expect(state.activeFile).toBe("/workspace/foo.ts");
      // Other fields remain at defaults
      expect(state.openEditors).toEqual([]);
      expect(state.activeFileLine).toBe(1);
    });

    it("§5.2: applyPatch sets cursor without requiring active file", () => {
      cache.applyPatch({ activeFileLine: 42, activeFileColumn: 7 });
      const state = cache.getState();
      expect(state.activeFileLine).toBe(42);
      expect(state.activeFileColumn).toBe(7);
      expect(state.activeFile).toBeNull();
    });

    it("§5.2: applyPatch replaces arrays entirely — no push-merge", () => {
      cache.applyPatch({ openEditors: ["/a.ts"] });
      cache.applyPatch({ openEditors: ["/b.ts", "/c.ts"] });
      expect(cache.getState().openEditors).toEqual(["/b.ts", "/c.ts"]);
    });

    it("§5.2: applyPatch merges modality keys — existing keys preserved", () => {
      // req-hub §5.2: modalities are per-extension keyed; adding one should not remove another
      cache.applyPatch({ modalities: { "accordo-editor": { isOpen: true } } });
      cache.applyPatch({ modalities: { "accordo-slides": { slide: 3 } } });
      const modalities = cache.getState().modalities;
      expect(modalities["accordo-editor"]).toEqual({ isOpen: true });
      expect(modalities["accordo-slides"]).toEqual({ slide: 3 });
    });

    it("§5.2: applyPatch replaces modality value for same extension key", () => {
      cache.applyPatch({ modalities: { "accordo-editor": { isOpen: true, count: 1 } } });
      cache.applyPatch({ modalities: { "accordo-editor": { isOpen: false } } });
      expect(cache.getState().modalities["accordo-editor"]).toEqual({ isOpen: false });
    });

    it("§5.2: successive applyPatch calls accumulate correctly", () => {
      cache.applyPatch({ activeFile: "/a.ts" });
      cache.applyPatch({ activeFileLine: 10 });
      cache.applyPatch({ workspaceFolders: ["/workspace"] });
      const state = cache.getState();
      expect(state.activeFile).toBe("/a.ts");
      expect(state.activeFileLine).toBe(10);
      expect(state.workspaceFolders).toEqual(["/workspace"]);
    });

    it("§5.2: applyPatch with empty object does not throw", () => {
      expect(() => cache.applyPatch({})).not.toThrow();
    });
  });

  // ── setSnapshot ───────────────────────────────────────────────────────────

  describe("setSnapshot", () => {
    it("§5.2: setSnapshot replaces the entire state", () => {
      // req-hub §5.2: Replace entire state — used on Bridge connect/reconnect
      const snapshot: IDEState = {
        activeFile: "/repo/main.ts",
        activeFileLine: 5,
        activeFileColumn: 12,
        openEditors: ["/repo/main.ts", "/repo/util.ts"],
        openTabs: [],
        visibleEditors: ["/repo/main.ts"],
        workspaceFolders: ["/repo"],
        activeTerminal: "bash",
        workspaceName: "my-repo",
        remoteAuthority: null,
        modalities: { "accordo-editor": { ready: true } },
      };
      cache.setSnapshot(snapshot);
      expect(cache.getState()).toEqual(snapshot);
    });

    it("§5.2: setSnapshot overwrites all previously patched fields", () => {
      cache.applyPatch({ activeFile: "/old.ts", activeFileLine: 99 });
      cache.setSnapshot(createEmptyState());
      expect(cache.getState().activeFile).toBeNull();
      expect(cache.getState().activeFileLine).toBe(1);
    });

    it("§5.2: setSnapshot stores a deep copy of the provided state", () => {
      const snapshot = createEmptyState();
      cache.setSnapshot(snapshot);
      snapshot.openEditors.push("/injected.ts");
      expect(cache.getState().openEditors).toEqual([]);
    });
  });

  // ── clearModalities ───────────────────────────────────────────────────────

  describe("clearModalities", () => {
    it("§5.2: clearModalities resets modalities to empty object", () => {
      // req-hub §5.2: called on Bridge disconnect timeout
      cache.applyPatch({ modalities: { "accordo-editor": { x: 1 }, "accordo-slides": { y: 2 } } });
      cache.clearModalities();
      expect(cache.getState().modalities).toEqual({});
    });

    it("§5.2: clearModalities leaves non-modality fields unchanged", () => {
      cache.applyPatch({ activeFile: "/keep.ts", modalities: { ext: { v: 1 } } });
      cache.clearModalities();
      const state = cache.getState();
      expect(state.activeFile).toBe("/keep.ts");
      expect(state.modalities).toEqual({});
    });
  });
});

// ── M74-OT-11: openTabs default in createEmptyState ──────────────────────────

describe("M74-OT-11: createEmptyState includes openTabs: []", () => {
  it("M74-OT-11: createEmptyState has openTabs field defaulting to empty array", () => {
    const state = createEmptyState();
    expect(state).toHaveProperty("openTabs");
    expect(state.openTabs).toEqual([]);
  });

  it("M74-OT-11: new StateCache instance getState() has openTabs: []", () => {
    const cache = new StateCache();
    expect(cache.getState().openTabs).toEqual([]);
  });

  it("M74-OT-11: applyPatch with openTabs replaces the array", () => {
    const cache = new StateCache();
    cache.applyPatch({
      openTabs: [
        { label: "server.ts", type: "text", path: "/server.ts", isActive: true, groupIndex: 0 },
      ],
    });
    expect(cache.getState().openTabs).toHaveLength(1);
    expect(cache.getState().openTabs[0].label).toBe("server.ts");
  });

  it("M74-OT-11: applyPatch with empty openTabs clears the array", () => {
    const cache = new StateCache();
    cache.applyPatch({
      openTabs: [
        { label: "a.ts", type: "text", path: "/a.ts", isActive: false, groupIndex: 0 },
      ],
    });
    cache.applyPatch({ openTabs: [] });
    expect(cache.getState().openTabs).toEqual([]);
  });
});

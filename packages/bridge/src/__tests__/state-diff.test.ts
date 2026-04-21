import { describe, expect, it } from "vitest";
import { computePatch, emptyState } from "../state-diff.js";

describe("state-diff", () => {
  it("emptyState returns expected IDEState defaults", () => {
    const s = emptyState();
    expect(s.openEditors).toEqual([]);
    expect(s.openTabs).toEqual([]);
    expect(s.modalities).toEqual({});
    expect(s.activeFileLine).toBe(1);
    expect(s.activeFileColumn).toBe(1);
  });

  it("computePatch returns null when states are equal", () => {
    const a = emptyState();
    const b = emptyState();
    expect(computePatch(a, b)).toBeNull();
  });

  it("computePatch returns only changed scalar and array fields", () => {
    const sent = emptyState();
    const cur = {
      ...sent,
      activeFile: "/tmp/file.ts",
      openEditors: ["/tmp/file.ts"],
      openTabs: [{ label: "file.ts", type: "text" as const, path: "/tmp/file.ts", isActive: true, groupIndex: 0 }],
    };

    const patch = computePatch(cur, sent);
    expect(patch).toEqual({
      activeFile: "/tmp/file.ts",
      openEditors: ["/tmp/file.ts"],
      openTabs: [{ label: "file.ts", type: "text" as const, path: "/tmp/file.ts", isActive: true, groupIndex: 0 }],
    });
  });

  it("computePatch includes modalities when changed", () => {
    const sent = emptyState();
    const cur = {
      ...sent,
      modalities: {
        "accordo.voice": { ttsAvailable: true },
      },
    };
    const patch = computePatch(cur, sent);
    expect(patch).toEqual({ modalities: { "accordo.voice": { ttsAvailable: true } } });
  });
});

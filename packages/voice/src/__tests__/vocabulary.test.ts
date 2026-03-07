/**
 * M50-VC — VoiceVocabulary tests (Phase B — must FAIL before implementation)
 * Coverage: M50-VC-01 through M50-VC-09
 */

import { describe, it, expect, beforeEach } from "vitest";
import { VoiceVocabulary } from "../text/vocabulary.js";
import { createMementoMock } from "./mocks/vscode.js";

describe("VoiceVocabulary", () => {
  let memento: ReturnType<typeof createMementoMock>;

  beforeEach(() => {
    memento = createMementoMock();
  });

  it("M50-VC-01: VoiceVocabulary class is exported", () => {
    expect(typeof VoiceVocabulary).toBe("function");
  });

  it("M50-VC-02: constructor accepts vscode.Memento", () => {
    expect(() => new VoiceVocabulary(memento)).not.toThrow();
  });

  it("M50-VC-09: loads existing entries from memento on construction", () => {
    const stored = [{ from: "lol", to: "laughing out loud" }];
    memento._store.set("accordo.voice.vocabulary", stored);
    const vocab = new VoiceVocabulary(memento);
    expect(vocab.getEntries()).toEqual(stored);
  });

  it("M50-VC-09: invalid memento data resets to empty", () => {
    memento._store.set("accordo.voice.vocabulary", "not-an-array");
    const vocab = new VoiceVocabulary(memento);
    expect(vocab.getEntries()).toEqual([]);
  });

  it("M50-VC-04: getEntries() returns current list", () => {
    const vocab = new VoiceVocabulary(memento);
    expect(vocab.getEntries()).toEqual([]);
  });

  it("M50-VC-05: addEntry() adds a new mapping", () => {
    const vocab = new VoiceVocabulary(memento);
    vocab.addEntry("brb", "be right back");
    const entries = vocab.getEntries();
    expect(entries).toContainEqual({ from: "brb", to: "be right back" });
  });

  it("M50-VC-05: addEntry() upserts existing entry", () => {
    const vocab = new VoiceVocabulary(memento);
    vocab.addEntry("brb", "be right back");
    vocab.addEntry("brb", "be right back soon");
    const entries = vocab.getEntries().filter((e) => e.from === "brb");
    expect(entries.length).toBe(1);
    expect(entries[0]!.to).toBe("be right back soon");
  });

  it("M50-VC-05: addEntry() persists to memento", async () => {
    const vocab = new VoiceVocabulary(memento);
    vocab.addEntry("lol", "laughing out loud");
    await new Promise((r) => setImmediate(r));
    const stored = memento.get("accordo.voice.vocabulary");
    expect(stored).toBeDefined();
  });

  it("M50-VC-06: removeEntry() removes the matching entry", () => {
    const vocab = new VoiceVocabulary(memento);
    vocab.addEntry("brb", "be right back");
    vocab.removeEntry("brb");
    expect(vocab.getEntries().some((e) => e.from === "brb")).toBe(false);
  });

  it("M50-VC-07: setEntries() replaces all entries", () => {
    const vocab = new VoiceVocabulary(memento);
    vocab.addEntry("old", "entry");
    vocab.setEntries([{ from: "new", to: "replacement" }]);
    expect(vocab.getEntries()).toEqual([{ from: "new", to: "replacement" }]);
  });

  it("M50-VC-03: process() applies vocabulary replacements", () => {
    const vocab = new VoiceVocabulary(memento);
    vocab.addEntry("brb", "be right back");
    expect(vocab.process("I'll brb soon.")).toContain("be right back");
  });

  it("M50-VC-03: process() applies longest-match first (no partial replacement)", () => {
    const vocab = new VoiceVocabulary(memento);
    vocab.addEntry("New York City", "NYC");
    vocab.addEntry("New York", "the big apple");
    // "New York City" should match the longer entry first
    const result = vocab.process("I live in New York City.");
    expect(result).toContain("NYC");
    expect(result).not.toContain("the big apple");
  });
});

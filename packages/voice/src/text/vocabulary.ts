/**
 * Voice vocabulary — user-configurable word replacement table for STT transcripts.
 *
 * M50-VC
 */

import type * as vscode from "vscode";

/** M50-VC: vocabulary entry */
export interface VocabularyEntry {
  from: string;
  to: string;
}

/** M50-VC-08 */
const PERSISTENCE_KEY = "accordo.voice.vocabulary";

/** M50-VC-01 */
export class VoiceVocabulary {
  private _entries: VocabularyEntry[] = [];
  private readonly _memento: vscode.Memento;

  /** M50-VC-02 + M50-VC-09: load from memento on construction */
  constructor(memento: vscode.Memento) {
    this._memento = memento;
    const stored = memento.get<unknown>(PERSISTENCE_KEY);
    if (Array.isArray(stored)) {
      this._entries = stored as VocabularyEntry[];
    }
    // M50-VC-09: invalid data resets to empty (already empty by default)
  }

  /**
   * M50-VC-03: apply replacements (longest-first), fix spacing.
   */
  process(text: string): string {
    // Fix double spaces and punctuation spacing first
    let result = text.replace(/  +/g, " ");

    // Sort longest-first to avoid partial matches
    const sorted = [...this._entries].sort((a, b) => b.from.length - a.from.length);
    for (const entry of sorted) {
      result = result.replaceAll(entry.from, entry.to);
    }
    return result;
  }

  /** M50-VC-04 */
  getEntries(): VocabularyEntry[] {
    return [...this._entries];
  }

  /** M50-VC-05: upsert + persist */
  addEntry(from: string, to: string): void {
    const idx = this._entries.findIndex((e) => e.from === from);
    if (idx >= 0) {
      this._entries[idx] = { from, to };
    } else {
      this._entries.push({ from, to });
    }
    void this._persist();
  }

  /** M50-VC-06: remove + persist */
  removeEntry(from: string): void {
    this._entries = this._entries.filter((e) => e.from !== from);
    void this._persist();
  }

  /** M50-VC-07: replace all + persist */
  setEntries(entries: VocabularyEntry[]): void {
    this._entries = [...entries];
    void this._persist();
  }

  private _persist(): Promise<void> {
    return this._memento.update(PERSISTENCE_KEY, this._entries) as Promise<void>;
  }
}

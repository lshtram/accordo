/**
 * Sentence splitter — splits cleaned text into sentences for incremental TTS.
 *
 * M50-SS
 */

/**
 * Split cleaned text into narration sentences.
 * M50-SS-01 + M50-SS-06: pure function, no side effects.
 */
export function splitIntoSentences(text: string): string[] {
  if (!text.trim()) return [];

  // M50-SS-02 + M50-SS-03: split on [.!?] followed by whitespace, or newlines
  const raw = text.split(/(?<=[.!?])\s+|\n+/);

  // M50-SS-04: trim and filter empty
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}

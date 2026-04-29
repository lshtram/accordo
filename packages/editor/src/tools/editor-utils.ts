/**
 * Editor tool utilities — arg extraction helpers and decoration store.
 *
 * Shared by editor-handlers.ts. Kept in a separate file to honour the
 * 300 LOC per-file limit (§5.3 of the handoff spec).
 */

import type * as vscode from "vscode";

// ── Arg extraction helpers ────────────────────────────────────────────────────

/** Extract a required string argument; throws if missing/wrong type. */
export function argString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string") throw new Error(`Argument '${key}' must be a string`);
  return v;
}

/** Extract an optional string argument. */
export function argStringOpt(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`Argument '${key}' must be a string`);
  return v;
}

/** Extract a required number argument; throws if missing/wrong type. */
export function argNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v !== "number") throw new Error(`Argument '${key}' must be a number`);
  return v;
}

/** Extract an optional number argument with a default. */
export function argNumberOpt(args: Record<string, unknown>, key: string, defaultValue: number): number {
  const v = args[key];
  if (v === undefined || v === null) return defaultValue;
  if (typeof v !== "number") throw new Error(`Argument '${key}' must be a number`);
  return v;
}

// ── Decoration store (§4.4, §4.5) ────────────────────────────────────────────

let decorationCounter = 0;

export interface HighlightEntry {
  readonly surface: "text" | "markdown-preview";
  clear(): void | PromiseLike<void>;
}

export interface TextHighlightEntry extends HighlightEntry {
  readonly surface: "text";
  readonly type: vscode.TextEditorDecorationType;
  readonly editor: vscode.TextEditor;
}

export interface PreviewHighlightEntry extends HighlightEntry {
  readonly surface: "markdown-preview";
  readonly uri: string;
}

/** Map from stable decorationId → clear strategy for text and preview highlights. */
export const decorationStore = new Map<string, HighlightEntry>();

/** Exposed for test teardown only. */
export function _clearDecorationStore(): void {
  for (const entry of decorationStore.values()) {
    void entry.clear();
  }
  decorationStore.clear();
  decorationCounter = 0;
}

/** Increment decoration counter and return the new ID string. */
export function nextDecorationId(): string {
  return `accordo-decoration-${++decorationCounter}`;
}

// ── Focus command lookup table (§4.7) ──────────────────────────────────────

export const FOCUS_COMMANDS = [
  "workbench.action.focusFirstEditorGroup",
  "workbench.action.focusSecondEditorGroup",
  "workbench.action.focusThirdEditorGroup",
  "workbench.action.focusFourthEditorGroup",
  "workbench.action.focusFifthEditorGroup",
  "workbench.action.focusSixthEditorGroup",
  "workbench.action.focusSeventhEditorGroup",
  "workbench.action.focusEighthEditorGroup",
  "workbench.action.focusNinthEditorGroup",
] as const;

/**
 * accordo-slidev — MCP Tool Definitions
 *
 * Creates and returns the 9 presentation tool definitions registered
 * with the Bridge via BridgeAPI.registerTools().
 *
 * All tool handler dependencies are injected via PresentationToolDeps
 * so the tool layer is unit-testable without VS Code.
 *
 * Source: requirements-slidev.md §3 (M44-TL-01 through M44-TL-09)
 *
 * Requirements:
 *   M44-TL-01  discover exists, ungrouped (prompt-visible), lists available deck files
 *   M44-TL-02  open opens a deck URI, returns error if file missing / invalid
 *   M44-TL-03  close ends session, kills process, disposes webview, resets state
 *   M44-TL-04  listSlides returns ordered slide metadata
 *   M44-TL-05  getCurrent returns current slide index + title
 *   M44-TL-06  goto moves to exact slide index
 *   M44-TL-07  next advances one slide
 *   M44-TL-08  prev goes back one slide
 *   M44-TL-09  generateNarration returns narration text for a slide (or all)
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { SlideSummary, SlideNarration } from "./types.js";

// ── Tool Dependency Interface ─────────────────────────────────────────────────

/**
 * All external dependencies for presentation tool handlers.
 * Injected so tools are testable without VS Code.
 */
export interface PresentationToolDeps {
  /**
   * M44-TL-01 / M44-TST-01
   * Returns workspace-relative paths to all .md files findable in the workspace.
   */
  discoverDeckFiles(): Promise<string[]>;

  /**
   * M44-TL-02
   * Opens a deck session. Returns `{}` on success, or `{ error }` on failure.
   */
  openSession(deckUri: string): Promise<{ error?: string }>;

  /**
   * M44-TL-03
   * Closes the current session. No-op if nothing is open.
   */
  closeSession(): void;

  /**
   * M44-TL-04
   */
  listSlides(): Promise<SlideSummary[] | { error: string }>;

  /**
   * M44-TL-05
   */
  getCurrent(): Promise<{ index: number; title: string } | { error: string }>;

  /**
   * M44-TL-06
   */
  goto(index: number): Promise<{ error?: string }>;

  /**
   * M44-TL-07
   */
  next(): Promise<{ error?: string }>;

  /**
   * M44-TL-08
   */
  prev(): Promise<{ error?: string }>;

  /**
   * M44-TL-09
   */
  generateNarration(
    target: number | "all",
  ): Promise<SlideNarration[] | { error: string }>;
}

// ── Tool factory ──────────────────────────────────────────────────────────────

/**
 * M44-TL-01 through M44-TL-09
 * Creates the nine presentation tool definitions.
 *
 * - discover: ungrouped (prompt-visible), safe
 * - open/close: group "presentation", moderate danger
 * - all others: group "presentation", safe
 */
export function createPresentationTools(
  deps: PresentationToolDeps,
): ExtensionToolDefinition[] {
  throw new Error("not implemented");
}

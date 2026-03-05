/**
 * accordo-slidev — Shared Package Types
 *
 * All types used internally by the accordo-slidev package.
 * Bridge-types are imported from @accordo/bridge-types.
 *
 * Source: requirements-slidev.md §5
 */

import type { ExtensionToolDefinition, CommentThread } from "@accordo/bridge-types";

// ── Session State ─────────────────────────────────────────────────────────────

/**
 * In-memory state for the active presentation session.
 * Source: requirements-slidev.md §5.1 (M44-STATE-02)
 */
export interface PresentationSessionState {
  isOpen: boolean;
  deckUri: string | null;
  currentSlide: number;
  totalSlides: number;
  narrationAvailable: boolean;
}

/** Default (closed) session state. */
export const INITIAL_SESSION_STATE: PresentationSessionState = {
  isOpen: false,
  deckUri: null,
  currentSlide: 0,
  totalSlides: 0,
  narrationAvailable: false,
};

// ── Slide Metadata ────────────────────────────────────────────────────────────

/**
 * Per-slide metadata returned by listSlides tool.
 * Source: requirements-slidev.md §5.2
 */
export interface SlideSummary {
  index: number;
  /** First # heading in the slide, or "Slide {index}" if no heading. */
  title: string;
  notesPreview?: string;
}

// ── Narration ─────────────────────────────────────────────────────────────────

/**
 * Per-slide narration output.
 * Source: requirements-slidev.md §5.3 (M44-NAR-02)
 */
export interface SlideNarration {
  slideIndex: number;
  narrationText: string;
}

// ── Deck Parsing ──────────────────────────────────────────────────────────────

/**
 * A single parsed slide — raw markdown content + optional speaker notes.
 */
export interface ParsedSlide {
  index: number;
  /** All content above the `<!-- notes -->` separator (or the whole slide if no notes). */
  content: string;
  /** Content below the `<!-- notes -->` separator, or null if absent. */
  notes: string | null;
}

/**
 * A parsed deck holding all slides.
 * Source: M44-RT-05 (deck validation structure)
 */
export interface ParsedDeck {
  slides: ParsedSlide[];
  /** Raw deck string as provided to parseDeck(). */
  raw: string;
}

/**
 * Deck validation result.
 * Source: M44-RT-05
 */
export interface DeckValidationResult {
  valid: boolean;
  error?: string;
}

// ── Process Spawner ───────────────────────────────────────────────────────────

/**
 * Injectable abstraction for spawning a child process.
 * Enables unit testing of PresentationProvider without actually launching Slidev.
 */
export interface ChildProcessHandle {
  /** Kill the process. */
  kill(): void;
  /** True if the process has exited. */
  readonly exited: boolean;
  /** Fires when process exits (code, signal). */
  onExit(listener: (code: number | null) => void): void;
}

export type ProcessSpawner = (
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
) => ChildProcessHandle;

// ── Bridge API (local interface — avoids hard accordo-bridge dependency) ──────

/**
 * Minimal BridgeAPI subset used by accordo-slidev.
 * Source: requirements-slidev.md M44-EXT-01, M44-EXT-05
 */
export interface BridgeAPI {
  registerTools(
    extensionId: string,
    tools: ExtensionToolDefinition[],
  ): { dispose(): void };
  publishState(extensionId: string, state: Record<string, unknown>): void;
}

// ── Surface Adapter (local interface — matches SurfaceCommentAdapter in comments) ──

/**
 * Subset of SurfaceCommentAdapter used by the presentation comments bridge.
 * Source: requirements-comments.md §5.2 (M40-EXT-11), requirements-slidev.md M44-CBR
 */
export interface SurfaceAdapterLike {
  createThread(args: {
    uri: string;
    anchor: import("@accordo/bridge-types").CommentAnchor;
    body: string;
    intent?: string;
  }): Promise<CommentThread>;
  reply(args: { threadId: string; body: string }): Promise<void>;
  resolve(args: { threadId: string; resolutionNote?: string }): Promise<void>;
  reopen(args: { threadId: string }): Promise<void>;
  delete(args: { threadId: string; commentId?: string }): Promise<void>;
  getThreadsForUri(uri: string): CommentThread[];
  onChanged(listener: (uri: string) => void): { dispose(): void };
}

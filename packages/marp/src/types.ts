/**
 * accordo-marp — Shared Package Types
 *
 * All types used internally by the accordo-marp package.
 * Bridge-types are imported from @accordo/bridge-types.
 *
 * Source: requirements-marp.md §5
 */

import type { ExtensionToolDefinition, CommentThread } from "@accordo/bridge-types";

// ── Session State ─────────────────────────────────────────────────────────────

/**
 * In-memory state for the active presentation session.
 * Source: requirements-marp.md §5.1 (M50-STATE-02)
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
 * Source: requirements-marp.md §5.2
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
 * Source: requirements-marp.md §5.3 (M50-NAR-02)
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
  /** All content above the notes separator (or the whole slide if no notes). */
  content: string;
  /** Content below the notes separator, or null if absent. */
  notes: string | null;
}

/**
 * A parsed deck holding all slides.
 */
export interface ParsedDeck {
  slides: ParsedSlide[];
  /** Raw deck string as provided to parseDeck(). */
  raw: string;
}

/**
 * Deck validation result.
 * Source: M50-RT-02
 */
export interface DeckValidationResult {
  valid: boolean;
  error?: string;
}

// ── Marp Render Result ────────────────────────────────────────────────────────

/**
 * Output of MarpRenderer.render().
 * Source: requirements-marp.md §5.4 (M50-RENDER-03)
 */
export interface MarpRenderResult {
  html: string;
  css: string;
  slideCount: number;
  /** Speaker notes per slide (empty string if no notes for that slide). */
  comments: string[];
}

// ── Bridge API (local interface — avoids hard accordo-bridge dependency) ──────

/**
 * Minimal BridgeAPI subset used by accordo-marp.
 * Source: requirements-marp.md M50-EXT-02, M50-EXT-06
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
 * Source: requirements-marp.md M50-CBR
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

/**
 * @accordo/comment-sdk — shared types for the webview-side comment UI.
 *
 * These interfaces are used by the SDK (webview) and mirrored in the
 * extension host's preview-bridge for the postMessage protocol.
 *
 * Source: comments-architecture.md §8.2, §8.3
 */

// ── Pin state ────────────────────────────────────────────────────────────────

/**
 * Visual state of a comment pin.
 *
 * open        — thread has at least one comment, not resolved
 * updated     — thread has new activity since the preview was loaded
 * resolved    — thread is resolved
 */
export type PinState = "open" | "updated" | "resolved";

// ── SDK thread model ─────────────────────────────────────────────────────────

/** A single comment as passed to the SDK. */
export interface SdkComment {
  id: string;
  author: { kind: "user" | "agent"; name: string };
  body: string;
  /** ISO 8601 */
  createdAt: string;
}

/** A thread as passed to the SDK for rendering. */
export interface SdkThread {
  id: string;
  /** The data-block-id of the element this pin is anchored to */
  blockId: string;
  status: "open" | "resolved";
  /** True when the thread has activity that the user hasn't seen yet */
  hasUnread: boolean;
  comments: SdkComment[];
}

// ── SDK coordinate interfaces ─────────────────────────────────────────────────

/** Screen position in pixels. */
export interface ScreenPosition {
  x: number;
  y: number;
}

/** Maps a blockId to a screen position. Returns null if the block is not visible. */
export type CoordinateToScreen = (blockId: string) => ScreenPosition | null;

// ── SDK callbacks (host → SDK action, SDK → host response) ───────────────────

/**
 * Callbacks provided by the host when initializing the SDK.
 * The SDK calls these when user interactions require host-side actions.
 * The host wires these to its own channel (postMessage, etc.).
 */
export interface SdkCallbacks {
  /**
   * Called when the user submits a new comment on a block.
   * @param blockId  The data-block-id of the clicked block
   * @param body     The comment text
   * @param intent   Optional intent tag ("fix", "review", etc.)
   */
  onCreate(blockId: string, body: string, intent?: string): void;

  /**
   * Called when the user replies to an existing thread.
   */
  onReply(threadId: string, body: string): void;

  /**
   * Called when the user resolves a thread.
   */
  onResolve(threadId: string, resolutionNote: string): void;

  /**
   * Called when the user reopens a resolved thread.
   */
  onReopen(threadId: string): void;

  /**
   * Called when the user deletes a thread or individual comment.
   * @param threadId   The thread to delete
   * @param commentId  If provided, deletes only that comment; else the entire thread
   */
  onDelete(threadId: string, commentId?: string): void;
}

// ── SDK init options ─────────────────────────────────────────────────────────

/** Options passed to `AccordoCommentSDK.init()`. */
export interface SdkInitOptions {
  /**
   * The container element the SDK should attach to.
   * Pins are rendered absolutely positioned relative to this element.
   */
  container: HTMLElement;

  /**
   * Resolves a blockId to a screen position for pin placement.
   * Returns null if the block is not in the current viewport.
   */
  coordinateToScreen: CoordinateToScreen;

  /** Callback handlers for user actions. */
  callbacks: SdkCallbacks;
}

// ── postMessage protocol (webview ↔ extension host) ──────────────────────────

/** Webview → extension host messages. */
export type WebviewMessage =
  | { type: "comment:create"; blockId: string; body: string; intent?: string }
  | { type: "comment:reply"; threadId: string; body: string }
  | { type: "comment:resolve"; threadId: string; resolutionNote: string }
  | { type: "comment:reopen"; threadId: string }
  | { type: "comment:delete"; threadId: string; commentId?: string };

/** Extension host → webview messages. */
export type HostMessage =
  | { type: "comments:load"; threads: SdkThread[] }
  | { type: "comments:add"; thread: SdkThread }
  | { type: "comments:update"; threadId: string; update: Partial<SdkThread> }
  | { type: "comments:remove"; threadId: string }
  /** Ask the webview to open the popover for a specific thread (from panel click). */
  | { type: "comments:focus"; threadId: string };

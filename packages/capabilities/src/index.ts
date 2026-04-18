/**
 * @accordo/capabilities
 *
 * Typed inter-extension capability interfaces for Accordo IDE.
 *
 * Provides:
 *   - CAPABILITY_COMMANDS  — canonical command ID string constants (8 stable)
 *   - DEFERRED_COMMANDS    — deferred command IDs for fallback invocation
 *   - SurfaceCommentAdapter — generalised surface adapter interface
 *   - CommentStoreAdapter   — narrower store interface used by md-viewer
 *   - CommentsCapability    — full 6-method comments capability
 *   - PreviewCapability     — markdown preview focus capability
 *   - DiagramCapability     — diagram focus capability
 *   - PresentationCapability — presentation goto + focus capability (from deferred.ts)
 *   - BrowserCapability     — browser focus capability (from deferred.ts)
 *   - CapabilityCommandMap  — maps each stable command to args tuple + return type
 *
 * No runtime code — purely types and constants.
 * Import types from @accordo/bridge-types where they already exist.
 */

import type { CommentAnchor, CommentIntent, CommentThread } from "@accordo/bridge-types";

// Re-export for consumers who need them alongside capability types
export type { CommentAnchor, CommentIntent, CommentThread };

// ─── Command ID Constants ─────────────────────────────────────────────────────

/**
 * All 8 stable command string constants — canonical values used by registerCommand
 * producers and executeCommand consumers.
 * Changing a value = single-point rename.
 */
export const CAPABILITY_COMMANDS = {
  // comments (producer: accordo-comments)
  COMMENTS_GET_STORE: "accordo_comments_internal_getStore",
  COMMENTS_GET_THREADS_FOR_URI: "accordo_comments_internal_getThreadsForUri",
  COMMENTS_CREATE_SURFACE_COMMENT: "accordo_comments_internal_createSurfaceComment",
  COMMENTS_RESOLVE_THREAD: "accordo_comments_internal_resolveThread",
  COMMENTS_GET_SURFACE_ADAPTER: "accordo_comments_internal_getSurfaceAdapter",
  COMMENTS_EXPAND_THREAD: "accordo_comments_internal_expandThread",

  // preview (producer: accordo-md-viewer)
  PREVIEW_FOCUS_THREAD: "accordo_preview_internal_focusThread",

  // diagram (producer: accordo-diagram)
  DIAGRAM_FOCUS_THREAD: "accordo_diagram_focusThread",
} as const;

/**
 * Deferred command constants — commands that are invoked by navigateToThread
 * as a fallback when no NavigationAdapter is registered for the target surface.
 * These are the same string values as CAPABILITY_COMMANDS but scoped to
 * the deferred-invocation pathway.
 *
 * Source: presentation-comments-modularity-A.md §17.4
 */
export const DEFERRED_COMMANDS = {
  PRESENTATION_GOTO: "accordo_presentation_internal_goto",
  /** Focus thread in presentation — used by deferred slide path after goto succeeds. */
  PRESENTATION_FOCUS_THREAD: "accordo.presentation.internal.focusThread",
  /** Focus thread in browser — used by deferred browser path. */
  BROWSER_FOCUS_THREAD: "accordo_browser_focusThread",
} as const;

// ─── SurfaceCommentAdapter ────────────────────────────────────────────────────

/**
 * Generalised surface adapter for any Accordo surface modality.
 * Accepts the full CommentAnchor verbatim — callers own anchor construction.
 *
 * Source: requirements-comments.md §5.2 (M40-EXT-11)
 * Moved from: packages/comments/src/bridge-integration.ts
 */
export interface SurfaceCommentAdapter {
  createThread(args: {
    uri: string;
    anchor: CommentAnchor;
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

// ─── CommentStoreAdapter ──────────────────────────────────────────────────────

/**
 * Narrower store adapter used by md-viewer (and similar surfaces that deal
 * with block-level anchoring rather than raw CommentAnchors).
 *
 * Corresponds to the CommentStoreLike interface in
 * packages/md-viewer/src/preview-bridge.ts.
 */
export interface CommentStoreAdapter {
  createThread(args: {
    uri: string;
    blockId: string;
    body: string;
    intent?: string;
    line?: number;
  }): Promise<CommentThread>;
  reply(args: { threadId: string; body: string }): Promise<void>;
  resolve(args: { threadId: string; resolutionNote?: string }): Promise<void>;
  reopen(args: { threadId: string }): Promise<void>;
  delete(args: { threadId: string; commentId?: string }): Promise<void>;
  getThreadsForUri(uri: string): CommentThread[];
  /** Listener fires after a mutation for the specified URI. */
  onChanged(listener: (uri: string) => void): { dispose(): void };
}

// ─── Capability Interfaces ────────────────────────────────────────────────────

/**
 * CommentsCapability — returned by accordo_comments_internal_getStore.
 *
 * 6 methods covering the full comment lifecycle for block-ID–based surfaces
 * (e.g. markdown preview).
 *
 * Sources:
 *   - accordo_comments_internal_getStore handler in bridge-integration.ts
 *   - accordo_comments_internal_getThreadsForUri handler
 *   - accordo_comments_internal_createSurfaceComment handler
 *   - accordo_comments_internal_resolveThread handler
 *   - accordo_comments_internal_getSurfaceAdapter handler
 *   - accordo_comments_internal_expandThread handler (native-comment-controller.ts)
 */
export interface CommentsCapability {
  /**
   * Returns the block-level store adapter (CommentStoreAdapter).
   * Producer: accordo_comments_internal_getStore
   */
  getStore(): Promise<CommentStoreAdapter>;

  /**
   * Returns all threads whose anchor URI matches the given URI.
   * Producer: accordo_comments_internal_getThreadsForUri
   */
  getThreadsForUri(uri: string): Promise<CommentThread[]>;

  /**
   * Creates a surface comment from a raw params object.
   * Producer: accordo_comments_internal_createSurfaceComment
   * Returns { threadId, commentId }.
   */
  createSurfaceComment(params: {
    uri: string;
    anchor: CommentAnchor;
    body: string;
    intent?: CommentIntent;
  }): Promise<{ threadId: string; commentId: string }>;

  /**
   * Resolves a thread by ID.
   * Producer: accordo_comments_internal_resolveThread
   */
  resolveThread(threadId: string): Promise<void>;

  /**
   * Returns a generalised SurfaceCommentAdapter with a full CommentAnchor API.
   * Producer: accordo_comments_internal_getSurfaceAdapter
   */
  getSurfaceAdapter(): Promise<SurfaceCommentAdapter>;

  /**
   * Expands the inline gutter comment widget for the given thread.
   * Returns true if the widget was found and expanded, false otherwise.
   * Producer: accordo_comments_internal_expandThread
   */
  expandThread(threadId: string): Promise<boolean>;
}

/**
 * PreviewCapability — registered by accordo-md-viewer.
 *
 * Finds the live webview panel for the given URI and sends a comments:focus
 * message to scroll to the specified thread/block.
 *
 * Source: accordo_preview_internal_focusThread handler in
 *         packages/md-viewer/src/extension.ts
 */
export interface PreviewCapability {
  /**
   * Focuses a thread in the live markdown preview panel for the given URI.
   *
   * @param uri      File URI of the markdown document
   * @param threadId ID of the thread to focus
   * @param blockId  Optional block ID hint for scroll positioning
   * @returns true if a live panel was found and focused; false otherwise
   */
  focusThread(uri: string, threadId: string, blockId?: string): Promise<boolean>;
}

/**
 * DiagramCapability — registered by accordo-diagram.
 *
 * Focuses a thread in an open diagram panel. If no panel is open for the
 * given URI, the command opens the panel first then focuses the thread.
 *
 * Source: accordo_diagram_focusThread handler in
 *         packages/diagram/src/extension.ts
 */
export interface DiagramCapability {
  /**
   * Focuses a thread in the diagram panel.
   *
   * @param threadId ID of the thread to focus
   * @param mmdUri   File URI of the .mmd diagram — used to open the panel
   *                 when no panel is currently showing
   */
  focusThread(threadId: string, mmdUri?: string): Promise<void>;
}

// ─── CapabilityCommandMap ─────────────────────────────────────────────────────

/**
 * Maps every capability command to its positional args tuple and return type.
 *
 * Intended for use by a future type-safe executeCommand wrapper:
 *
 * ```ts
 * async function invoke<K extends keyof CapabilityCommandMap>(
 *   command: K,
 *   ...args: CapabilityCommandMap[K]["args"]
 * ): Promise<CapabilityCommandMap[K]["result"]>
 * ```
 */
export interface CapabilityCommandMap {
  // ── comments ───────────────────────────────────────────────────────────────
  readonly [CAPABILITY_COMMANDS.COMMENTS_GET_STORE]: {
    args: [];
    result: CommentStoreAdapter;
  };
  readonly [CAPABILITY_COMMANDS.COMMENTS_GET_THREADS_FOR_URI]: {
    args: [uri: string];
    result: CommentThread[];
  };
  readonly [CAPABILITY_COMMANDS.COMMENTS_CREATE_SURFACE_COMMENT]: {
    args: [params: Record<string, unknown>];
    result: { threadId: string; commentId: string };
  };
  readonly [CAPABILITY_COMMANDS.COMMENTS_RESOLVE_THREAD]: {
    args: [threadId: string];
    result: void;
  };
  readonly [CAPABILITY_COMMANDS.COMMENTS_GET_SURFACE_ADAPTER]: {
    args: [];
    result: SurfaceCommentAdapter;
  };
  readonly [CAPABILITY_COMMANDS.COMMENTS_EXPAND_THREAD]: {
    args: [threadId: string];
    result: boolean;
  };

  // ── preview ────────────────────────────────────────────────────────────────
  readonly [CAPABILITY_COMMANDS.PREVIEW_FOCUS_THREAD]: {
    args: [uri: string, threadId: string, blockId?: string];
    result: boolean;
  };

  // ── diagram ────────────────────────────────────────────────────────────────
  readonly [CAPABILITY_COMMANDS.DIAGRAM_FOCUS_THREAD]: {
    args: [threadId: string, mmdUri?: string];
    result: void;
  };
}

// ─── Navigation Adapter Registry ───────────────────────────────────────────────

export { createNavigationAdapterRegistry } from "./navigation.js";
export type { NavigationAdapterRegistry, NavigationAdapter, NavigationEnv } from "./navigation.js";

// ─── Deferred Capability Re-exports ───────────────────────────────────────────
// PresentationCapability and BrowserCapability live in deferred.ts to keep them
// off the stable public surface. Re-export here for consumers that import them
// from @accordo/capabilities directly.

export type { PresentationCapability } from "./deferred.js";
export type { BrowserCapability } from "./deferred.js";

/**
 * @accordo/capabilities — deferred contracts
 *
 * Deferred interfaces that are reserved for future module batches.
 * These are NOT part of the active public surface of @accordo/capabilities.
 * They must NOT be implemented as active contracts outside this file.
 *
 * Source: capabilities-foundation-phase-a.md §3.2
 */



/**
 * PresentationCapability — to be registered by accordo-marp (not yet wired).
 *
 * Navigate to a slide and/or focus a comment thread in the presentation webview.
 *
 * Sources (call sites in navigation-router.ts):
 *   - accordo_presentation_internal_goto    → coords.slideIndex (number)
 *   - accordo_presentation_internal_focusThread → thread.id (string)
 */
export interface PresentationCapability {
  /**
   * Navigate the presentation to the given 0-based slide index.
   * Throws if no presentation session is open.
   *
   * @param slideIndex 0-based slide index
   */
  goto(slideIndex: number): Promise<void>;

  /**
   * Focus a comment thread popover in the presentation webview.
   *
   * @param threadId ID of the thread to focus
   */
  focusThread(threadId: string): Promise<void>;
}

/**
 * BrowserCapability — to be registered by accordo-browser (not yet wired).
 *
 * Focus a comment thread in the Chrome browser extension popup/content script.
 *
 * Source (call site in navigation-router.ts):
 *   - accordo_browser_focusThread → thread.id (string)
 */
export interface BrowserCapability {
  /**
   * Focus a comment thread in the connected browser extension.
   *
   * @param threadId ID of the thread to focus
   */
  focusThread(threadId: string): Promise<void>;
}

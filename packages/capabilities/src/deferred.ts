/**
 * @accordo/capabilities — deferred contracts
 *
 * Deferred interfaces reserved for non-stable capability pathways.
 * They may be re-exported as types from package root, but remain explicitly
 * outside the stable active capability set.
 *
 * Source: capabilities-foundation-phase-a.md §3.2
 */



/**
 * PresentationCapability — deferred presentation contract.
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
 * BrowserCapability — deferred browser-focus contract.
 *
 * Focus a comment thread in the Chrome browser extension popup/content script.
 *
 * Source (call site in navigation-router.ts):
 *   - accordo_browser.focusThread → thread.id (string)
 */
export interface BrowserCapability {
  /**
   * Focus a comment thread in the connected browser extension.
   *
   * @param threadId ID of the thread to focus
   */
  focusThread(threadId: string): Promise<void>;
}

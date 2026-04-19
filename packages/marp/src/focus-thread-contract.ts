import * as vscode from "vscode";

/**
 * Normalized focus request for presentation-thread routing.
 */
export interface PresentationFocusThreadRequest {
  readonly requestedDeckUri: string;
  readonly currentDeckUri: string | null;
  readonly threadId: string;
  readonly blockId: string;
}

/**
 * Decision model consumed by the focus-thread command handler.
 */
export interface PresentationFocusThreadPlan {
  readonly normalizedDeckUri: string;
  readonly shouldOpenDeck: boolean;
  readonly targetSlideIndex: number | null;
  readonly focusMessage: {
    readonly type: "comments:focus";
    readonly threadId: string;
    readonly blockId: string;
  };
}

/**
 * Normalize any deck locator (`file:///...` or fsPath) into an absolute fsPath.
 */
export function normalizeDeckUriToFsPath(uriOrPath: string): string {
  throw new Error("not implemented");
}

/**
 * Parse slide index from a `slide:{index}:{x}:{y}` block id.
 * Returns null when the blockId is not a valid slide coordinate id.
 */
export function parseSlideIndex(blockId: string): number | null {
  throw new Error("not implemented");
}

/**
 * Build the canonical focus-thread dispatch plan for Marp.
 */
export function buildPresentationFocusThreadPlan(
  request: PresentationFocusThreadRequest,
): PresentationFocusThreadPlan {
  throw new Error("not implemented");
}

/**
 * Validate whether a slide index is safe for the webview `goTo()` call.
 */
export function isValidSlideIndex(index: number, slideCount: number): boolean {
  throw new Error("not implemented");
}

/**
 * Convert a URI/path input into a VS Code Uri suitable for openTextDocument calls.
 */
export function toVsCodeUri(uriOrPath: string): vscode.Uri {
  throw new Error("not implemented");
}

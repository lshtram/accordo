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
  if (uriOrPath.startsWith("file://")) {
    return uriOrPath.slice("file://".length);
  }
  return uriOrPath;
}

/**
 * Parse slide index from a `slide:{index}:{x}:{y}` block id.
 * Returns null when the blockId is not a valid slide coordinate id.
 */
export function parseSlideIndex(blockId: string): number | null {
  const match = /^slide:(\d+):\d+\.\d+:\d+\.\d+$/.exec(blockId);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isNaN(index) ? null : index;
}

/**
 * Build the canonical focus-thread dispatch plan for Marp.
 */
export function buildPresentationFocusThreadPlan(
  request: PresentationFocusThreadRequest,
): PresentationFocusThreadPlan {
  const normalizedRequested = normalizeDeckUriToFsPath(request.requestedDeckUri);
  const currentDeckNormalized =
    request.currentDeckUri != null ? normalizeDeckUriToFsPath(request.currentDeckUri) : null;
  const shouldOpenDeck = currentDeckNormalized !== normalizedRequested;
  return {
    normalizedDeckUri: normalizedRequested,
    shouldOpenDeck,
    targetSlideIndex: parseSlideIndex(request.blockId),
    focusMessage: {
      type: "comments:focus",
      threadId: request.threadId,
      blockId: request.blockId,
    },
  };
}

/**
 * Validate whether a slide index is safe for the webview `goTo()` call.
 */
export function isValidSlideIndex(index: number, slideCount: number): boolean {
  return index >= 0 && index < slideCount && Number.isFinite(index);
}

/**
 * Convert a URI/path input into a VS Code Uri suitable for openTextDocument calls.
 */
export function toVsCodeUri(uriOrPath: string): vscode.Uri {
  if (uriOrPath.startsWith("file://")) {
    return vscode.Uri.parse(uriOrPath);
  }
  return vscode.Uri.file(uriOrPath);
}

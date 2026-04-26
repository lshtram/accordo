/**
 * Layout tool handlers for accordo-editor.
 *
 * Implements layout tools from requirements-editor.md §4.
 */

import type { ExtensionToolDefinition, IDEState } from "@accordo/bridge-types";
import { wrapHandler } from "../util.js";
import { barTools } from "./bar.js";

const LAYOUT_STATE_COMMENT_SUMMARY_LIMIT = 20;

function sanitizeCommentSummaryEntry(entry: unknown): Record<string, unknown> | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const source = entry as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  if (typeof source["threadId"] === "string") sanitized["threadId"] = source["threadId"];
  if (typeof source["uri"] === "string") sanitized["uri"] = source["uri"];
  if (typeof source["preview"] === "string") sanitized["preview"] = source["preview"];
  if (typeof source["intent"] === "string") sanitized["intent"] = source["intent"];
  if (typeof source["line"] === "number") sanitized["line"] = source["line"];
  if (typeof source["surfaceType"] === "string") sanitized["surfaceType"] = source["surfaceType"];

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function sanitizeLayoutState(state: IDEState): IDEState {
  const commentModality = state.modalities["accordo-comments"];
  if (typeof commentModality !== "object" || commentModality === null) {
    return state;
  }

  const source = commentModality as Record<string, unknown>;
  const summary = Array.isArray(source["summary"]) ? source["summary"] : [];
  const sanitizedSummary = summary
    .slice(0, LAYOUT_STATE_COMMENT_SUMMARY_LIMIT)
    .map(sanitizeCommentSummaryEntry)
    .filter((entry): entry is Record<string, unknown> => entry !== null);

  const sanitizedCommentModality: Record<string, unknown> = {
    isOpen: source["isOpen"] === true,
    openThreadCount:
      typeof source["openThreadCount"] === "number" ? source["openThreadCount"] : 0,
    resolvedThreadCount:
      typeof source["resolvedThreadCount"] === "number" ? source["resolvedThreadCount"] : 0,
    summary: sanitizedSummary,
  };

  return {
    ...state,
    modalities: {
      ...state.modalities,
      "accordo-comments": sanitizedCommentModality,
    },
  };
}

// ── Tool definitions (Module 20) ─────────────────────────────────────────────

/** All layout tool definitions for module 20 (toggle tool retired). */
export const layoutTools: ExtensionToolDefinition[] = [];

// ── §4.25 accordo_layout_state ─────────────────────────────────────────────────────

/**
 * Return a snapshot of the current IDE state from the Bridge-local cache.
 * Reads StatePublisher.currentState directly — no Hub network call.
 *
 * @param _args   Ignored — tool takes no input parameters.
 * @param getState  Injected accessor for Bridge-local IDEState.
 */
export async function layoutStateHandler(
  _args: Record<string, unknown>,
  getState: () => IDEState,
): Promise<{ ok: true; state: IDEState } | { ok: false; error: string }> {
  try {
    const state = getState();
    return { ok: true, state: sanitizeLayoutState(state) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Factory that returns all layout tool definitions, including accordo_layout_state.
 * The getState callback is injected from extension.ts so the tool can read
 * Bridge-local IDEState without importing from accordo-bridge directly.
 *
 * @param getState  Returns current IDEState from StatePublisher.
 */
export function createLayoutTools(getState: () => IDEState): ExtensionToolDefinition[] {
  return [
    ...layoutTools,
    ...barTools,
    {
      name: "accordo_layout_state",
      group: "layout",
      description:
        "Return the current IDE state snapshot with lightweight comment metadata only (counts + summary). Call this at the start of every task to orientate yourself before taking any action.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: wrapHandler("accordo_layout_state", (args) => layoutStateHandler(args, getState)),
    },
  ];
}

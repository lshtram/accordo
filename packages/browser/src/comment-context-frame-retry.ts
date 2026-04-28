/**
 * comment-context-frame-retry.ts — Frame-agnostic recovery helpers.
 *
 * Extracted from comment-context-helpers.ts for modularity.
 * retryAcrossFrames <= 30 lines; each helper <= 30 lines.
 *
 * @module
 */

import type { BrowserRelayLike } from "./types.js";
import type { PageMapResponse, PageToolError } from "./page-tool-types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { handleGetPageMap, handleGetDomExcerpt, handleInspectElement } from "./page-tool-handlers.js";
import { isPageToolError, isFoundResult } from "./comment-context-common.js";
import { matchesStoredMetadata } from "./comment-context-metadata.js";

interface FrameNode {
  frameId: string;
  sameOrigin: boolean;
  iframes?: readonly { frameId: string; sameOrigin: boolean; iframes?: readonly unknown[] }[];
}

// ── Frame collection (<= 12 lines) ─────────────────────────────────────────

function collectFrameIds(iframes: readonly FrameNode[] | undefined): string[] {
  if (!iframes) return [];
  const result: string[] = [];
  for (const iframe of iframes) {
    if (iframe.sameOrigin) result.push(iframe.frameId);
    result.push(...collectFrameIds(iframe.iframes as readonly FrameNode[] | undefined));
  }
  return result;
}

// ── Frame candidate ordering (<= 12 lines) ────────────────────────────────

function buildCandidateFrames(preferredFrameId: string | undefined, discoveredFrames: string[]): string[] {
  if (preferredFrameId) {
    return [preferredFrameId, ...discoveredFrames.filter((f) => f !== preferredFrameId), "main"];
  }
  return ["main", ...discoveredFrames];
}

// ── Main retry coordinator (<= 30 lines) ───────────────────────────────────

export async function retryAcrossFrames(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
  baseArgs: Record<string, unknown>,
  surfaceMetadata?: Record<string, string | undefined>,
  redactPII: boolean = false,
  preferredFrameId?: string,
): Promise<{ inspect: unknown; excerpt: unknown } | undefined> {
  const pageMap = await fetchFramePageMap(relay, store, security, baseArgs);
  if (isPageToolError(pageMap)) return undefined;
  const discoveredFrames = collectFrameIds((pageMap as PageMapResponse).iframes as readonly FrameNode[] | undefined);
  const candidates = buildCandidateFrames(preferredFrameId, discoveredFrames);
  for (const frameId of candidates) {
    const result = await tryFrame(relay, store, security, baseArgs, frameId, surfaceMetadata, redactPII);
    if (result !== undefined) return result;
  }
  return undefined;
}

async function fetchFramePageMap(relay: BrowserRelayLike, store: SnapshotRetentionStore, security: SecurityConfig, baseArgs: Record<string, unknown>): Promise<PageMapResponse | PageToolError> {
  return handleGetPageMap(relay, {
    traverseFrames: true,
    tabId: baseArgs.tabId as number | undefined,
    allowedOrigins: baseArgs.allowedOrigins as string[] | undefined,
    deniedOrigins: baseArgs.deniedOrigins as string[] | undefined,
    redactPII: baseArgs.redactPII as boolean | undefined,
  }, store, security) as Promise<PageMapResponse | PageToolError>;
}

async function tryFrame(relay: BrowserRelayLike, store: SnapshotRetentionStore, security: SecurityConfig, baseArgs: Record<string, unknown>, frameId: string, surfaceMetadata: Record<string, string | undefined> | undefined, redactPII: boolean): Promise<{ inspect: unknown; excerpt: unknown } | undefined> {
  const attemptArgs = { ...baseArgs, frameId };
  const inspect = await handleInspectElement(relay, attemptArgs, store, security);
  const excerpt = await handleGetDomExcerpt(relay, attemptArgs, store, security);
  if (!resultFound(inspect) || !resultFound(excerpt)) return undefined;
  return matchesStoredMetadata(surfaceMetadata, inspect, excerpt, redactPII) ? { inspect, excerpt } : undefined;
}

function resultFound(value: unknown): boolean {
  return !isPageToolError(value) && isFoundResult(value) && value.found === true;
}

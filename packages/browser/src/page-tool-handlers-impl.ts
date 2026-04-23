/**
 * M91-PU + M91-CR — Page Tool Handler Implementations
 *
 * All handler functions that forward requests through the browser relay
 * to the Chrome extension's content script.
 *
 * @module
 */

import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { ScreenshotRetentionStore } from "./screenshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { checkOrigin, extractOrigin, mergeOriginPolicy, redactPageMapResponse, redactInspectElementResponse, redactDomExcerptResponse, redactTextMapResponse, redactSemanticGraphResponse, DEFAULT_SECURITY_CONFIG } from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";
export { handleCaptureRegion } from "./page-tool-capture-handler.js";
export { handleGetPageMap } from "./page-tool-page-map-handler.js";
export { handleInspectElement } from "./page-tool-inspect-handler.js";
export { handleGetDomExcerpt } from "./page-tool-dom-excerpt-handler.js";
export { handleGetTextMapInline } from "./page-tool-text-map-inline-handler.js";
export { handleGetSemanticGraphInline } from "./page-tool-semantic-graph-inline-handler.js";
export { handleListPages, handleSelectPage, handleWaitForInline } from "./page-tool-tab-handlers.js";
import { mapRelayError } from "./page-tool-relay-errors.js";

import type {
  CaptureRegionArgs,
  CaptureRegionResponse,
  DomExcerptResponse,
  GetDomExcerptArgs,
  GetPageMapArgs,
  GetSemanticGraphArgs,
  GetTextMapArgs,
  IframeMetadata,
  InspectElementArgs,
  InspectElementResponse,
  ListPagesArgs,
  ListPagesResponse,
  PageMapResponse,
  PageToolError,
  SelectPageArgs,
  SelectPageResponse,
  WaitForArgs,
} from "./page-tool-types.js";

import {
  CAPTURE_REGION_TIMEOUT_MS,
  classifyRelayError,
  EXCERPT_TIMEOUT_MS,
  INSPECT_TIMEOUT_MS,
  PAGE_MAP_TIMEOUT_MS,
  SEMANTIC_GRAPH_TIMEOUT_MS,
  TAB_MGMT_TIMEOUT_MS,
  TEXT_MAP_TIMEOUT_MS,
  WAIT_FOR_RELAY_TIMEOUT_MS,
} from "./page-tool-types.js";

// ── Tool Handlers ─────────────────────────────────────────────────────────────


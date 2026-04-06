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
import type { SecurityConfig } from "./security/index.js";
import { checkOrigin, extractOrigin, mergeOriginPolicy, redactPageMapResponse, redactInspectElementResponse, redactDomExcerptResponse, redactTextMapResponse, redactSemanticGraphResponse, DEFAULT_SECURITY_CONFIG } from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";

import type {
  CaptureRegionArgs,
  CaptureRegionResponse,
  DomExcerptResponse,
  GetDomExcerptArgs,
  GetPageMapArgs,
  GetSemanticGraphArgs,
  GetTextMapArgs,
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

/**
 * Handler for browser_get_page_map.
 *
 * Forwards to the Chrome relay's `get_page_map` action and returns
 * the structured page map result.
 *
 * B2-SV-003: The canonical SnapshotEnvelope (pageId, frameId, snapshotId,
 * capturedAt, viewport, source) is embedded inside `response.data` by the
 * content script. This handler validates the envelope is present before
 * returning the data.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention
 * store so agents can retrieve recent snapshots without re-requesting.
 *
 * @see PU-F-50, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleGetPageMap(
  relay: BrowserRelayLike,
  args: GetPageMapArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<PageMapResponse | PageToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as PageToolError;
  }

  const tabId = args.tabId ? String(args.tabId) : "main";

  // F4: Create audit entry (start early; origin field may be updated after relay)
  const auditEntry = security.auditLog.createEntry("accordo_browser_get_page_map", undefined, undefined);
  const startTime = Date.now();

  try {
    const response = await relay.request("get_page_map", args as Record<string, unknown>, PAGE_MAP_TIMEOUT_MS);
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "pageUrl" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      const relayPageUrl = (response.data as { pageUrl?: string }).pageUrl;

      // F1: Origin policy check using the pageUrl from the relay response.
      // This runs after DOM access but BEFORE saving to the store or returning
      // to the caller, ensuring blocked origins never reach the agent.
      if (relayPageUrl) {
        const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
        const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
        if (checkOrigin(origin, policy) === "block") {
          security.auditLog.completeEntry(auditEntry, {
            action: "blocked",
            redacted: false,
            durationMs: Date.now() - startTime,
          });
          return buildStructuredError("origin-blocked") as PageToolError;
        }
      }

      store.save(response.data.pageId, response.data);
      const result = response.data as PageMapResponse;
      // F4: Add auditId to response
      (result as any).auditId = auditEntry.auditId;

      // F2: Apply redaction if requested (fail-closed)
      if (args.redactPII) {
        try {
          const redactionOccurred = redactPageMapResponse(result as any, security.redactionPolicy);
          (result as any).redactionApplied = redactionOccurred;
        } catch {
          security.auditLog.completeEntry(auditEntry, {
            action: "blocked",
            redacted: false,
            durationMs: Date.now() - startTime,
          });
          return buildStructuredError("redaction-failed") as PageToolError;
        }
      } else {
        // F5: Redaction warning when redactPII is not set
        (result as any).redactionWarning = "PII may be present in response";
      }

      security.auditLog.completeEntry(auditEntry, {
        action: "allowed",
        redacted: !!(result as any).redactionApplied,
        durationMs: Date.now() - startTime,
      });

      // Return a shallow copy so subsequent calls don't overwrite auditId on the same object
      return { ...result };
    }
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError("action-failed") as PageToolError;
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(classifyRelayError(err)) as PageToolError;
  }
}

/**
 * Handler for browser_inspect_element.
 *
 * Forwards to the Chrome relay's `inspect_element` action and returns
 * the detailed element inspection result.
 *
 * B2-SV-003: The canonical SnapshotEnvelope is embedded inside `response.data`
 * by the content script. This handler validates the envelope before returning.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention store.
 *
 * B2-SV-006: Supports lookup by `nodeId` from a page map snapshot.
 *
 * @see PU-F-51, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleInspectElement(
  relay: BrowserRelayLike,
  args: InspectElementArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<InspectElementResponse | PageToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as PageToolError;
  }

  // F4: Create audit entry before relay call
  const auditEntry = security.auditLog.createEntry("accordo_browser_inspect_element", undefined, undefined);
  const startTime = Date.now();

  try {
    const response = await relay.request(
      "inspect_element",
      args as Record<string, unknown>,
      INSPECT_TIMEOUT_MS,
    );
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "found" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      const relayPageUrl = (response.data as { pageUrl?: string }).pageUrl;

      // F1: Origin policy check using the pageUrl from the relay response.
      if (relayPageUrl) {
        const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
        const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
        if (checkOrigin(origin, policy) === "block") {
          security.auditLog.completeEntry(auditEntry, {
            action: "blocked",
            redacted: false,
            durationMs: Date.now() - startTime,
          });
          return buildStructuredError("origin-blocked") as PageToolError;
        }
      }

      store.save(response.data.pageId, response.data);
      const result = response.data as InspectElementResponse;
      // F4: Add auditId to response
      (result as any).auditId = auditEntry.auditId;

      // F2: Apply redaction if requested (fail-closed)
      if (args.redactPII) {
        try {
          const redactionOccurred = redactInspectElementResponse(result as any, security.redactionPolicy);
          (result as any).redactionApplied = redactionOccurred;
        } catch {
          security.auditLog.completeEntry(auditEntry, {
            action: "blocked",
            redacted: false,
            durationMs: Date.now() - startTime,
          });
          return buildStructuredError("redaction-failed") as PageToolError;
        }
      } else {
        // F5: Redaction warning when redactPII is not set
        (result as any).redactionWarning = "PII may be present in response";
      }

      security.auditLog.completeEntry(auditEntry, {
        action: "allowed",
        redacted: !!(result as any).redactionApplied,
        durationMs: Date.now() - startTime,
      });

      // Return a shallow copy so subsequent calls don't overwrite auditId on the same object
      return { ...result };
    }
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError("action-failed") as PageToolError;
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(classifyRelayError(err)) as PageToolError;
  }
}

/**
 * Handler for browser_get_dom_excerpt.
 *
 * Forwards to the Chrome relay's `get_dom_excerpt` action and returns
 * the sanitized HTML fragment.
 *
 * B2-SV-003: The canonical SnapshotEnvelope is embedded inside `response.data`
 * by the content script. This handler validates the envelope before returning.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention store.
 *
 * @see PU-F-52, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleGetDomExcerpt(
  relay: BrowserRelayLike,
  args: GetDomExcerptArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<DomExcerptResponse | PageToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as PageToolError;
  }

  // F4: Create audit entry before relay call
  const auditEntry = security.auditLog.createEntry("accordo_browser_get_dom_excerpt", undefined, undefined);
  const startTime = Date.now();

  try {
    const response = await relay.request(
      "get_dom_excerpt",
      args as unknown as Record<string, unknown>,
      EXCERPT_TIMEOUT_MS,
    );
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "found" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
      const relayPageUrl = (response.data as { pageUrl?: string }).pageUrl;

      // F1: Origin policy check using the pageUrl from the relay response.
      if (relayPageUrl) {
        const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
        const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
        if (checkOrigin(origin, policy) === "block") {
          security.auditLog.completeEntry(auditEntry, {
            action: "blocked",
            redacted: false,
            durationMs: Date.now() - startTime,
          });
          return buildStructuredError("origin-blocked") as PageToolError;
        }
      }

      store.save(response.data.pageId, response.data);
      const result = response.data as DomExcerptResponse;
      // F4: Add auditId to response
      (result as any).auditId = auditEntry.auditId;

      // F2: Apply redaction if requested (fail-closed)
      if (args.redactPII) {
        try {
          const redactionOccurred = redactDomExcerptResponse(result as any, security.redactionPolicy);
          (result as any).redactionApplied = redactionOccurred;
        } catch {
          security.auditLog.completeEntry(auditEntry, {
            action: "blocked",
            redacted: false,
            durationMs: Date.now() - startTime,
          });
          return buildStructuredError("redaction-failed") as PageToolError;
        }
      } else {
        // F5: Redaction warning when redactPII is not set
        (result as any).redactionWarning = "PII may be present in response";
      }

      security.auditLog.completeEntry(auditEntry, {
        action: "allowed",
        redacted: !!(result as any).redactionApplied,
        durationMs: Date.now() - startTime,
      });

      // Return a shallow copy so subsequent calls don't overwrite auditId on the same object
      return { ...result };
    }
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError("action-failed") as PageToolError;
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(classifyRelayError(err)) as PageToolError;
  }
}

/**
 * Handler for browser_capture_region (M91-CR).
 *
 * Forwards to the Chrome relay's `capture_region` action. The content
 * script resolves the target element to viewport-relative bounds, the
 * service worker captures `captureVisibleTab()` and crops using
 * `OffscreenCanvas`, then returns the cropped JPEG data URL.
 *
 * B2-SV-003: The relay embeds the SnapshotEnvelope (sourced from the content
 * script) in the capture response. This handler validates its presence,
 * consistent with the other 3 data-producing tool handlers.
 *
 * B2-SV-004: On success the envelope is persisted into the shared retention store.
 *
 * @see CR-F-01, CR-F-08, CR-F-11, CR-F-12
 */
export async function handleCaptureRegion(
  relay: BrowserRelayLike,
  args: CaptureRegionArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<CaptureRegionResponse | PageToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as PageToolError;
  }

  // F4: Create audit entry before relay call
  const auditEntry = security.auditLog.createEntry("accordo_browser_capture_region", undefined, undefined);
  const startTime = Date.now();

  try {
    // GAP-I1: When redactPatterns are configured, embed them in the payload so the
    // extension can apply bbox-based redaction to the screenshot. The warning is
    // always shown when patterns exist (MCP-VC-005), regardless of args.redact.
    const payload: Record<string, unknown> = { ...args };
    const hasRedactPatterns = security.redactionPolicy.redactPatterns.length > 0;
    if (hasRedactPatterns) {
      payload.redactPatterns = security.redactionPolicy.redactPatterns.map((p: { pattern: string }) => p.pattern);
    }

    const response = await relay.request(
      "capture_region",
      payload,
      CAPTURE_REGION_TIMEOUT_MS,
    );
    if (response.success && response.data && typeof response.data === "object" && hasSnapshotEnvelope(response.data)) {
      const data = response.data;
        // B2-SV-003: Check the inner success field to detect capture-level failures
        if ("success" in data && data.success === true) {
        const relayPageUrl = (data as { pageUrl?: string }).pageUrl;

        // F1: Origin policy check using the pageUrl from the relay response.
        if (relayPageUrl) {
          const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
          const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
          if (checkOrigin(origin, policy) === "block") {
            security.auditLog.completeEntry(auditEntry, {
              action: "blocked",
              redacted: false,
              durationMs: Date.now() - startTime,
            });
            return buildStructuredError("origin-blocked") as PageToolError;
          }
        }

        // GAP-E2: Get the most recent DOM snapshot ID BEFORE saving this capture
        const previousSnapshot = store.getLatest(data.pageId);
        const relatedSnapshotId = previousSnapshot?.snapshotId;

        store.save(data.pageId, data);
        const result = data as CaptureRegionResponse;
        // F4: Add auditId to response
        (result as any).auditId = auditEntry.auditId;
        // GAP-I1: screenshotRedactionApplied and redactedSegmentCount are returned from the extension
        const relayData = data as Record<string, unknown>;
        if (relayData.screenshotRedactionApplied !== undefined) {
          (result as CaptureRegionResponse).screenshotRedactionApplied = relayData.screenshotRedactionApplied as boolean;
        }
        if (relayData.redactedSegmentCount !== undefined) {
          (result as CaptureRegionResponse).redactedSegmentCount = relayData.redactedSegmentCount as number;
        }
        // GAP-E2: Attach relatedSnapshotId linking this capture to the previous DOM snapshot
        if (relatedSnapshotId !== undefined) {
          (result as CaptureRegionResponse).relatedSnapshotId = relatedSnapshotId;
        }
        // MCP-VC-005: Always warn when redactPatterns are configured (screenshots are not fully subject to PII redaction)
        if (hasRedactPatterns) {
          (result as CaptureRegionResponse).redactionWarning = "screenshots-not-subject-to-redaction-policy";
        }
        // Return a shallow copy so subsequent calls don't overwrite auditId on the same object
        return { ...result };
      }
      // Relay returned a capture-level error (element-off-screen, image-too-large, capture-failed, etc.)
      if ("error" in data && typeof data.error === "string") {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return buildStructuredError(data.error as string) as PageToolError;
      }
    }
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError("action-failed") as PageToolError;
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(classifyRelayError(err)) as PageToolError;
  }
}

/**
 * Handler for browser_wait_for (inlined into buildPageUnderstandingTools).
 */
export async function handleWaitForInline(
  relay: BrowserRelayLike,
  args: WaitForArgs,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }
  try {
    const response = await relay.request("wait_for", args as Record<string, unknown>, WAIT_FOR_RELAY_TIMEOUT_MS);
    if (response.success && response.data !== undefined) {
      return response.data;
    }
    const errCode = response.error ?? "timeout";
    if (errCode === "navigation-interrupted" || errCode === "page-closed") {
      return { met: false, error: errCode, elapsedMs: 0 };
    }
    return response.data ?? { met: false, error: "timeout", elapsedMs: 0 };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_get_text_map (inlined into buildPageUnderstandingTools).
 */
export async function handleGetTextMapInline(
  relay: BrowserRelayLike,
  args: GetTextMapArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }

  // F4: Create audit entry before relay call
  const auditEntry = security.auditLog.createEntry("accordo_browser_get_text_map", undefined, undefined);
  const startTime = Date.now();

  try {
    const response = await relay.request("get_text_map", args as Record<string, unknown>, TEXT_MAP_TIMEOUT_MS);
    if (!response.success || response.data === undefined) {
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return { success: false, error: response.error ?? "action-failed" };
    }

    const relayPageUrl = (response.data as { pageUrl?: string }).pageUrl;

    // F1: Origin policy check before data access
    if (relayPageUrl) {
      const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
      const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
      if (checkOrigin(origin, policy) === "block") {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return { success: false, error: "origin-blocked" };
      }
    }

    if (hasSnapshotEnvelope(response.data)) {
      store.save(response.data.pageId, response.data);
    }

    const result = response.data as Record<string, unknown>;
    // F4: Add auditId to response
    result.auditId = auditEntry.auditId;

    // F2: Apply redaction if requested (fail-closed)
    if (args.redactPII) {
      try {
        const redactionOccurred = redactTextMapResponse(result as any, security.redactionPolicy);
        result.redactionApplied = redactionOccurred;
      } catch {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return { success: false, error: "redaction-failed" };
      }
    } else {
      // F5: Redaction warning when redactPII not set
      result.redactionWarning = "PII may be present in response";
    }

    security.auditLog.completeEntry(auditEntry, {
      action: "allowed",
      redacted: !!(result as any).redactionApplied,
      durationMs: Date.now() - startTime,
    });

    return result;
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_get_semantic_graph (inlined into buildPageUnderstandingTools).
 */
export async function handleGetSemanticGraphInline(
  relay: BrowserRelayLike,
  args: GetSemanticGraphArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }

  // F4: Create audit entry before relay call
  const auditEntry = security.auditLog.createEntry("accordo_browser_get_semantic_graph", undefined, undefined);
  const startTime = Date.now();

  try {
    const payload: Record<string, unknown> = {};
    if (args.tabId !== undefined) payload["tabId"] = args.tabId;
    if (args.maxDepth !== undefined) payload["maxDepth"] = args.maxDepth;
    if (args.visibleOnly !== undefined) payload["visibleOnly"] = args.visibleOnly;

    const response = await relay.request("get_semantic_graph", payload, SEMANTIC_GRAPH_TIMEOUT_MS);
    if (!response.success || response.data === undefined) {
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return { success: false, error: response.error ?? "action-failed" };
    }

    const relayPageUrl = (response.data as { pageUrl?: string }).pageUrl;

    // F1: Origin policy check before data access
    if (relayPageUrl) {
      const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
      const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
      if (checkOrigin(origin, policy) === "block") {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return { success: false, error: "origin-blocked" };
      }
    }

    if (hasSnapshotEnvelope(response.data)) {
      store.save(response.data.pageId, response.data as SnapshotEnvelopeFields);
    }

    const result = response.data as Record<string, unknown>;
    // F4: Add auditId to response
    result.auditId = auditEntry.auditId;

    // F2: Apply redaction if requested (fail-closed)
    if (args.redactPII) {
      try {
        const redactionOccurred = redactSemanticGraphResponse(result as any, security.redactionPolicy);
        result.redactionApplied = redactionOccurred;
      } catch {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return { success: false, error: "redaction-failed" };
      }
    } else {
      // F5: Redaction warning when redactPII not set
      result.redactionWarning = "PII may be present in response";
    }

    security.auditLog.completeEntry(auditEntry, {
      action: "allowed",
      redacted: !!(result as any).redactionApplied,
      durationMs: Date.now() - startTime,
    });

    return result;
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_list_pages (B2-CTX-001).
 * Forwards to relay's "list_pages" action.
 */
export async function handleListPages(
  relay: BrowserRelayLike,
  args: ListPagesArgs,
): Promise<ListPagesResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", pageUrl: null };
  }
  try {
    const response = await relay.request("list_pages", args as Record<string, unknown>, TAB_MGMT_TIMEOUT_MS);
    if (response.success && response.data && typeof response.data === "object" && "pages" in response.data) {
      return response.data as ListPagesResponse;
    }
    return { success: false, error: "action-failed", pageUrl: null };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), pageUrl: null };
  }
}

/**
 * Handler for browser_select_page (B2-CTX-001).
 * Forwards to relay's "select_page" action.
 */
export async function handleSelectPage(
  relay: BrowserRelayLike,
  args: SelectPageArgs,
): Promise<SelectPageResponse | PageToolError> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected", pageUrl: null };
  }
  try {
    const response = await relay.request("select_page", args as unknown as Record<string, unknown>, TAB_MGMT_TIMEOUT_MS);
    if (response.success) {
      return { success: true };
    }
    return { success: false, error: response.error ?? "action-failed", pageUrl: null };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err), pageUrl: null };
  }
}

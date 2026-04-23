import { hasSnapshotEnvelope } from "./types.js";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import {
  checkOrigin,
  DEFAULT_SECURITY_CONFIG,
  extractOrigin,
  mergeOriginPolicy,
  redactTextMapResponse,
} from "./security/index.js";
import type { GetTextMapArgs } from "./page-tool-types.js";
import { TEXT_MAP_TIMEOUT_MS } from "./page-tool-types.js";
import { classifyRelayError } from "./page-tool-types.js";
import type { TextMapResponse, TextSegment } from "./text-map-tool-contracts.js";

interface TextMapInlineResult extends TextMapResponse {
  auditId?: string;
}

export async function handleGetTextMapInline(
  relay: BrowserRelayLike,
  args: GetTextMapArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }

  const effectiveCap = Math.min(args.maxSegments ?? 500, 2000);
  const clampedOffset = Math.max(0, args.offset ?? 0);
  const clampedLimit = args.limit !== undefined
    ? Math.min(Math.max(1, args.limit), effectiveCap)
    : undefined;
  const paginationArgsProvided = args.offset !== undefined || args.limit !== undefined;
  const payload: Record<string, unknown> = { ...args };
  if (args.offset !== undefined) {
    payload.offset = clampedOffset;
  } else {
    delete payload.offset;
  }
  if (args.limit !== undefined) {
    payload.limit = clampedLimit;
  } else {
    delete payload.limit;
  }

  const auditEntry = security.auditLog.createEntry("accordo_browser_get_text_map", undefined, undefined);
  const startTime = Date.now();

  try {
    const response = await relay.request("get_text_map", payload, TEXT_MAP_TIMEOUT_MS);
    if (!response.success || response.data === undefined) {
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return { success: false, error: response.error ?? "action-failed" };
    }

    const relayPageUrl = (response.data as { pageUrl?: string }).pageUrl;
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

    const result = { ...(response.data as TextMapResponse) } as TextMapInlineResult;
    result.auditId = auditEntry.auditId;

    if (args.redactPII) {
      try {
        result.redactionApplied = redactTextMapResponse(result, security.redactionPolicy);
      } catch {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return { success: false, error: "redaction-failed" };
      }
    } else {
      result.redactionWarning = "PII may be present in response";
    }

    security.auditLog.completeEntry(auditEntry, {
      action: "allowed",
      redacted: !!result.redactionApplied,
      durationMs: Date.now() - startTime,
    });

    if (paginationArgsProvided) {
      const effectiveLimit = clampedLimit ?? effectiveCap;
      const allSegments: TextSegment[] = result.segments;
      const slicedSegments = allSegments.slice(clampedOffset, clampedOffset + effectiveLimit);
      result.segments = slicedSegments;

      const totalSegments = result.totalSegments ?? 0;
      const totalAvailable = result.truncated
        ? Math.min(totalSegments, effectiveCap)
        : totalSegments;
      result.hasMore = (clampedOffset + slicedSegments.length) < totalAvailable;
      result.totalAvailable = totalAvailable;
      if (slicedSegments.length > 0) {
        result.nextOffset = clampedOffset + slicedSegments.length;
      }
    }

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

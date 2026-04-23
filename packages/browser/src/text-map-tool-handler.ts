import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { checkOrigin, extractOrigin, mergeOriginPolicy, redactTextMapResponse } from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";
import { TEXT_MAP_TIMEOUT_MS, type GetTextMapArgs, type TextMapResponse, type TextMapToolError } from "./text-map-tool-contracts.js";

function classifyTextMapRelayError(err: unknown): "timeout" | "browser-not-connected" {
  if (err instanceof Error) {
    if (err.message.includes("not-connected") || err.message.includes("disconnected")) {
      return "browser-not-connected";
    }
    return "timeout";
  }
  return "timeout";
}

export async function handleGetTextMap(
  relay: BrowserRelayLike,
  args: GetTextMapArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): Promise<TextMapResponse | TextMapToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as TextMapToolError;
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
      const errCode = String(response.error ?? "action-failed");
      const mappedError: TextMapToolError["error"] =
        errCode === "browser-not-connected" ? "browser-not-connected"
        : errCode === "timeout" ? "timeout"
        : errCode === "origin-blocked" ? "origin-blocked"
        : errCode === "iframe-cross-origin" ? "iframe-cross-origin"
        : errCode === "no-content-script" ? "no-content-script"
        : "action-failed";
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return buildStructuredError(mappedError) as TextMapToolError;
    }

    const data = response.data;
    const relayPageUrl = (data as { pageUrl?: string }).pageUrl;

    if (relayPageUrl) {
      const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
      const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
      if (checkOrigin(origin, policy) === "block") {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return buildStructuredError("origin-blocked") as TextMapToolError;
      }
    }

    if (hasSnapshotEnvelope(data)) {
      store.save(data.pageId, data as SnapshotEnvelopeFields);
    }

    const result = { ...data } as TextMapResponse;

    if (args.redactPII) {
      try {
        const redactionOccurred = redactTextMapResponse(result as any, security.redactionPolicy);
        (result as any).redactionApplied = redactionOccurred;
      } catch {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return buildStructuredError("redaction-failed") as TextMapToolError;
      }
    } else {
      (result as any).redactionWarning = "PII may be present in response";
    }

    (result as any).auditId = auditEntry.auditId;

    security.auditLog.completeEntry(auditEntry, {
      action: "allowed",
      redacted: !!(result as any).redactionApplied,
      durationMs: Date.now() - startTime,
    });

    if (paginationArgsProvided) {
      const effectiveLimit = clampedLimit ?? effectiveCap;
      const allSegments = result.segments;
      const slicedSegments = allSegments.slice(clampedOffset, clampedOffset + effectiveLimit);
      result.segments = slicedSegments;

      const totalAvailable = result.truncated
        ? Math.min(result.totalSegments, effectiveCap)
        : result.totalSegments;
      const hasMore = (clampedOffset + slicedSegments.length) < totalAvailable;
      result.hasMore = hasMore;
      result.totalAvailable = totalAvailable;
      if (slicedSegments.length > 0) {
        result.nextOffset = clampedOffset + slicedSegments.length;
      }
    }

    return { ...result };
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(classifyTextMapRelayError(err)) as TextMapToolError;
  }
}

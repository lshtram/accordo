import type { BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import { hasSnapshotEnvelope } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { extractOrigin, mergeOriginPolicy, redactTextMapResponse } from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";
import { TEXT_MAP_DEFAULT_MAX_SEGMENTS, TEXT_MAP_MAX_SEGMENTS, TEXT_MAP_TIMEOUT_MS, type GetTextMapArgs, type TextMapResponse, type TextMapToolError } from "./text-map-tool-contracts.js";
import { runPageToolPipeline } from "./page-tool-pipeline.js";
import { classifyThrownRelayError } from "./relay-error-policy.js";

interface AuditedTextMapResponse extends TextMapResponse {
  auditId?: string;
}

export async function handleGetTextMap(
  relay: BrowserRelayLike,
  args: GetTextMapArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
): Promise<TextMapResponse | TextMapToolError> {
  const effectiveCap = Math.min(args.maxSegments ?? TEXT_MAP_DEFAULT_MAX_SEGMENTS, TEXT_MAP_MAX_SEGMENTS);
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

  const pipeline = await runPageToolPipeline(
    relay,
    payload,
    store,
    security,
    {
      toolName: "accordo_browser_get_text_map",
      relayAction: "get_text_map",
      timeoutMs: TEXT_MAP_TIMEOUT_MS,
      validateResponse: (data) => {
        if (data && typeof data === "object" && "pageUrl" in data && hasSnapshotEnvelope(data)) {
          return { ...(data as TextMapResponse) } as AuditedTextMapResponse;
        }
        return null;
      },
      mapRelayError: (error) => {
        const errCode = String(error ?? "action-failed");
        return errCode === "browser-not-connected" ? "browser-not-connected"
          : errCode === "timeout" ? "timeout"
          : errCode === "origin-blocked" ? "origin-blocked"
          : errCode === "iframe-cross-origin" ? "iframe-cross-origin"
          : errCode === "no-content-script" ? "no-content-script"
          : "action-failed";
      },
      mapThrownError: classifyThrownRelayError,
      extractOrigin: (response) => {
        const relayPageUrl = response.pageUrl;
        return relayPageUrl ? extractOrigin(relayPageUrl) ?? relayPageUrl : undefined;
      },
      resolveOriginPolicy: () => mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins),
      persistSnapshot: (_response, rawData) => {
        if (hasSnapshotEnvelope(rawData)) {
          store.save(rawData.pageId, rawData as SnapshotEnvelopeFields);
        }
      },
      redact: (response) => {
        response.redactionApplied = redactTextMapResponse(response, security.redactionPolicy);
        return response;
      },
      postProcess: (response) => {
        if (!args.redactPII) {
          response.redactionWarning = "PII may be present in response";
        }
        if (paginationArgsProvided) {
          const effectiveLimit = clampedLimit ?? effectiveCap;
          const slicedSegments = response.segments.slice(clampedOffset, clampedOffset + effectiveLimit);
          response.segments = slicedSegments;
          const totalAvailable = response.truncated
            ? Math.min(response.totalSegments, effectiveCap)
            : response.totalSegments;
          response.hasMore = (clampedOffset + slicedSegments.length) < totalAvailable;
          response.totalAvailable = totalAvailable;
          if (slicedSegments.length > 0) {
            response.nextOffset = clampedOffset + slicedSegments.length;
          }
        }
        return response;
      },
    },
  );
  return pipeline.success ? (pipeline.data as TextMapResponse) : (pipeline.error as TextMapToolError);
}

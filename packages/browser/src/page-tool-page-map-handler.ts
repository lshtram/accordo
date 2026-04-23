import { hasSnapshotEnvelope } from "./types.js";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import {
  checkOrigin,
  DEFAULT_SECURITY_CONFIG,
  extractOrigin,
  mergeOriginPolicy,
  redactPageMapResponse,
} from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";
import type { GetPageMapArgs, IframeMetadata, PageMapResponse, PageToolError } from "./page-tool-types.js";
import { classifyRelayError, PAGE_MAP_TIMEOUT_MS } from "./page-tool-types.js";
import { mapRelayError } from "./page-tool-relay-errors.js";

export async function handleGetPageMap(
  relay: BrowserRelayLike,
  args: GetPageMapArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<PageMapResponse | PageToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as PageToolError;
  }

  const effectiveCap = Math.min(args.maxNodes ?? 200, 500);
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

  const auditEntry = security.auditLog.createEntry("accordo_browser_get_page_map", undefined, undefined);
  const startTime = Date.now();

  try {
    const response = await relay.request("get_page_map", payload, PAGE_MAP_TIMEOUT_MS);
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "pageUrl" in response.data &&
      hasSnapshotEnvelope(response.data)
    ) {
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
          return buildStructuredError("origin-blocked") as PageToolError;
        }
      }

      store.save(response.data.pageId, response.data);
      const result = { ...response.data } as PageMapResponse;
      result.auditId = auditEntry.auditId;

      if (args.frameFilter && args.frameFilter.length > 0 && result.iframes) {
        const allowed = new Set<IframeMetadata["classification"]>(args.frameFilter);
        result.iframes = result.iframes.filter((f) => allowed.has(f.classification ?? "unknown"));
      }

      if (args.redactPII) {
        try {
          result.redactionApplied = redactPageMapResponse(result, security.redactionPolicy);
        } catch {
          security.auditLog.completeEntry(auditEntry, {
            action: "blocked",
            redacted: false,
            durationMs: Date.now() - startTime,
          });
          return buildStructuredError("redaction-failed") as PageToolError;
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
        const slicedNodes = result.nodes.slice(clampedOffset, clampedOffset + effectiveLimit);
        result.nodes = slicedNodes;

        const filteredTotal = result.filterSummary?.totalAfterFilter;
        const preCapTotal = typeof filteredTotal === "number" ? filteredTotal : result.totalElements;
        const totalAvailable = result.truncated ? Math.min(preCapTotal, effectiveCap) : preCapTotal;
        result.hasMore = (clampedOffset + slicedNodes.length) < totalAvailable;
        result.totalAvailable = totalAvailable;
        if (slicedNodes.length > 0) {
          result.nextOffset = clampedOffset + slicedNodes.length;
        }
      }

      return { ...result };
    }
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(mapRelayError(response.error)) as PageToolError;
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(classifyRelayError(err)) as PageToolError;
  }
}

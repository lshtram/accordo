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
import { runPageToolPipeline } from "./page-tool-pipeline.js";
import { PAGE_MAP_DEFAULT_MAX_NODES, PAGE_MAP_MAX_NODES } from "./page-tool-page-map-types.js";

export async function handleGetPageMap(
  relay: BrowserRelayLike,
  args: GetPageMapArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<PageMapResponse | PageToolError> {
  const effectiveCap = Math.min(args.maxNodes ?? PAGE_MAP_DEFAULT_MAX_NODES, PAGE_MAP_MAX_NODES);
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

  const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
  // B2-CTX-002: Extract tabId from args for snapshot tabId recovery in diff_snapshots
  const snapshotTabId = args.tabId;
  const pipeline = await runPageToolPipeline(
    relay,
    payload,
    store,
    security,
    {
      toolName: "accordo_browser_get_page_map",
      relayAction: "get_page_map",
      timeoutMs: PAGE_MAP_TIMEOUT_MS,
      validateResponse: (data) => {
        if (data && typeof data === "object" && "pageUrl" in data && hasSnapshotEnvelope(data)) {
          return { ...data } as PageMapResponse;
        }
        return null;
      },
      mapRelayError,
      mapThrownError: classifyRelayError,
      extractOrigin: (response) => {
        const relayPageUrl = response.pageUrl;
        return relayPageUrl ? extractOrigin(relayPageUrl) ?? relayPageUrl : undefined;
      },
      redact: (response) => {
        if (args.redactPII === true) {
          response.redactionApplied = redactPageMapResponse(response, security.redactionPolicy);
        }
        return response;
      },
      postProcess: (response) => {
        if (args.frameFilter && args.frameFilter.length > 0 && response.iframes) {
          const allowed = new Set<IframeMetadata["classification"]>(args.frameFilter);
          response.iframes = response.iframes.filter((f) => allowed.has(f.classification ?? "unknown"));
        }
        if (!args.redactPII) {
          response.redactionWarning = "PII may be present in response";
        }
        if (paginationArgsProvided) {
          const effectiveLimit = clampedLimit ?? effectiveCap;
          const slicedNodes = response.nodes.slice(clampedOffset, clampedOffset + effectiveLimit);
          response.nodes = slicedNodes;
          const filteredTotal = response.filterSummary?.totalAfterFilter;
          const preCapTotal = typeof filteredTotal === "number" ? filteredTotal : response.totalElements;
          const totalAvailable = response.truncated ? Math.min(preCapTotal, effectiveCap) : preCapTotal;
          response.hasMore = (clampedOffset + slicedNodes.length) < totalAvailable;
          response.totalAvailable = totalAvailable;
          if (slicedNodes.length > 0) {
            response.nextOffset = clampedOffset + slicedNodes.length;
          }
        }
        return response;
      },
      // B2-CTX-002: Record tabId used for capture so diff_snapshots can recover it
      persistTabId: () => snapshotTabId,
    },
  );
  return pipeline.success ? (pipeline.data as PageMapResponse) : (pipeline.error as PageToolError);
}

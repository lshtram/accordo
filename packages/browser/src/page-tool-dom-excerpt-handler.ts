import { hasSnapshotEnvelope } from "./types.js";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import {
  checkOrigin,
  DEFAULT_SECURITY_CONFIG,
  extractOrigin,
  mergeOriginPolicy,
  redactDomExcerptResponse,
} from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";
import type { DomExcerptResponse, GetDomExcerptArgs, PageToolError } from "./page-tool-types.js";
import { classifyRelayError, EXCERPT_TIMEOUT_MS } from "./page-tool-types.js";
import { mapRelayError } from "./page-tool-relay-errors.js";
import { runPageToolPipeline } from "./page-tool-pipeline.js";
import { domExcerptTargetKind, hasDomExcerptTarget, isMalformedSelector } from "./target-validation.js";

export async function handleGetDomExcerpt(
  relay: BrowserRelayLike,
  args: GetDomExcerptArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<DomExcerptResponse | PageToolError> {
  if (!hasDomExcerptTarget(args)) {
    return buildStructuredError("no-target", "Provide anchorKey or selector.");
  }
  if (domExcerptTargetKind(args) === "selector" && isMalformedSelector(args.selector)) {
    return buildStructuredError("invalid-request", "selector must be a valid CSS selector.");
  }
  const pipeline = await runPageToolPipeline(
    relay,
    args as unknown as Record<string, unknown>,
    store,
    security,
    {
      toolName: "accordo_browser_get_dom_excerpt",
      relayAction: "get_dom_excerpt",
      timeoutMs: EXCERPT_TIMEOUT_MS,
      validateResponse: (data) => {
        if (data && typeof data === "object" && "found" in data && hasSnapshotEnvelope(data)) {
          return { ...data } as DomExcerptResponse;
        }
        return null;
      },
      mapRelayError,
      mapThrownError: classifyRelayError,
      extractOrigin: (response) => {
        const relayPageUrl = (response as { pageUrl?: string }).pageUrl;
        return relayPageUrl ? extractOrigin(relayPageUrl) ?? relayPageUrl : undefined;
      },
      resolveOriginPolicy: () => mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins),
      persistSnapshot: (response) => store.save(response.pageId, response),
      // B2-CTX-002: Record tabId used for capture so diff_snapshots can recover it
      persistTabId: (a) => (a as GetDomExcerptArgs).tabId,
      redact: (response) => {
        if (args.redactPII === true) {
          response.redactionApplied = redactDomExcerptResponse(response, security.redactionPolicy) || response.redactionApplied === true;
        }
        return response;
      },
      postProcess: (response) => {
        if (!args.redactPII) {
          response.redactionWarning = "PII may be present in response";
        }
        return response;
      },
    },
  );
  return pipeline.success ? (pipeline.data as DomExcerptResponse) : (pipeline.error as PageToolError);
}

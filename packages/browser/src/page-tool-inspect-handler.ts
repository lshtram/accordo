import { hasSnapshotEnvelope } from "./types.js";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import {
  checkOrigin,
  DEFAULT_SECURITY_CONFIG,
  extractOrigin,
  mergeOriginPolicy,
  redactInspectElementResponse,
} from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";
import type { InspectElementArgs, InspectElementResponse, PageToolError } from "./page-tool-types.js";
import { classifyRelayError, INSPECT_TIMEOUT_MS } from "./page-tool-types.js";
import { mapRelayError } from "./page-tool-relay-errors.js";
import { runPageToolPipeline } from "./page-tool-pipeline.js";

export async function handleInspectElement(
  relay: BrowserRelayLike,
  args: InspectElementArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
): Promise<InspectElementResponse | PageToolError> {
  const pipeline = await runPageToolPipeline(
    relay,
    args as Record<string, unknown>,
    store,
    security,
    {
      toolName: "accordo_browser_inspect_element",
      relayAction: "inspect_element",
      timeoutMs: INSPECT_TIMEOUT_MS,
      validateResponse: (data) => {
        if (data && typeof data === "object" && "found" in data && hasSnapshotEnvelope(data)) {
          return { ...data } as InspectElementResponse;
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
      redact: (response) => {
        response.redactionApplied = redactInspectElementResponse(response, security.redactionPolicy);
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
  return pipeline.success ? (pipeline.data as InspectElementResponse) : (pipeline.error as PageToolError);
}

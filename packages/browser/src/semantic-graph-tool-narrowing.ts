import { hasSnapshotEnvelope } from "./types.js";
import type { GetSemanticGraphArgs, SemanticGraphResponse } from "./semantic-graph-tool-contracts.js";

export function narrowSemanticGraphArgs(raw: unknown): GetSemanticGraphArgs {
  if (typeof raw !== "object" || raw === null) return {};

  const obj = raw as Record<string, unknown>;
  const result: GetSemanticGraphArgs = {};

  if (typeof obj["tabId"] === "number") result.tabId = obj["tabId"];
  if (typeof obj["maxDepth"] === "number") result.maxDepth = obj["maxDepth"];
  if (typeof obj["visibleOnly"] === "boolean") result.visibleOnly = obj["visibleOnly"];
  if (typeof obj["piercesShadow"] === "boolean") result.piercesShadow = obj["piercesShadow"];
  if (typeof obj["frameId"] === "string") result.frameId = obj["frameId"];
  if (typeof obj["redactPII"] === "boolean") result.redactPII = obj["redactPII"];
  if (Array.isArray(obj["allowedOrigins"])) result.allowedOrigins = obj["allowedOrigins"] as string[];
  if (Array.isArray(obj["deniedOrigins"])) result.deniedOrigins = obj["deniedOrigins"] as string[];

  return result;
}

export function narrowSemanticGraphResponse(data: unknown): SemanticGraphResponse | undefined {
  if (typeof data !== "object" || data === null) return undefined;

  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj["a11yTree"]) || !Array.isArray(obj["landmarks"]) || !Array.isArray(obj["outline"]) || !Array.isArray(obj["forms"])) {
    return undefined;
  }
  if (typeof obj["pageUrl"] !== "string" || typeof obj["title"] !== "string") {
    return undefined;
  }
  if (!hasSnapshotEnvelope(data)) return undefined;

  return data as SemanticGraphResponse;
}

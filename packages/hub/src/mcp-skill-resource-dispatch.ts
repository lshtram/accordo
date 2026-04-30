import { listSkillResources, readSkillResource } from "./skill-resources/index.js";
import type { JsonRpcResponse } from "./mcp-dispatch.js";

export function handleResourcesList(id: string | number | null): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result: { resources: listSkillResources() },
  };
}

export function handleResourcesRead(
  id: string | number | null,
  params: Record<string, unknown>,
): JsonRpcResponse {
  const uri = params["uri"];
  if (typeof uri !== "string" || !uri) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32602, message: "resources/read requires a non-empty uri" },
    };
  }

  const resource = readSkillResource(uri);
  if (!resource) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32002, message: "Resource not found", data: { uri } },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    result: {
      contents: [
        {
          uri: resource.uri,
          mimeType: "text/markdown",
          text: resource.text,
        },
      ],
    },
  };
}

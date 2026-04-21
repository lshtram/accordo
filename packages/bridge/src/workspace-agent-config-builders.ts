/**
 * Pure builders for workspace-scoped agent config files.
 *
 * Scope: `opencode.json` and `.claude/mcp.json` only.
 */

/** Current schema version for workspace agent config files. */
export const ACCORDO_SCHEMA_VERSION = "1.0";

export function buildOpencodeConfig(
  port: number,
  token: string,
  existingRaw?: string | undefined,
): Record<string, unknown> {
  let existing: Record<string, unknown> = {};
  if (existingRaw !== undefined) {
    try {
      existing = JSON.parse(existingRaw) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  delete existing["_accordo_schema"];
  delete existing["instructions_url"];
  delete existing["instructions"];

  const existingMcp = (existing["mcp"] ?? {}) as Record<string, unknown>;
  return {
    ...existing,
    $schema: "https://opencode.ai/config.json",
    mcp: {
      ...existingMcp,
      accordo: {
        type: "remote",
        url: `http://localhost:${port}/mcp`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
}

export function buildClaudeConfig(
  port: number,
  token: string,
  existingRaw: string | undefined,
): Record<string, unknown> {
  let existing: Record<string, unknown> = {};
  if (existingRaw !== undefined) {
    try {
      existing = JSON.parse(existingRaw) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  const existingServers = (existing["mcpServers"] ?? {}) as Record<string, unknown>;
  return {
    ...existing,
    _accordo_schema: ACCORDO_SCHEMA_VERSION,
    mcpServers: {
      ...existingServers,
      accordo: {
        type: "http",
        url: `http://localhost:${port}/mcp`,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  };
}

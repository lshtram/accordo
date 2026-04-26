/**
 * Argument validation for list handler.
 * Extracted to keep handler body focused.
 *
 * Requirements: M75-VCG-02, 03 (requirements-editor.md §4.26)
 */

import type { VscodeCommandErrorResponse } from "./vscode-command-contracts.js";

export function validateListArgs(args: Record<string, unknown>): VscodeCommandErrorResponse | null {
  if (args.offset !== undefined && typeof args.offset !== "number") {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "offset must be a number", retriable: false } };
  }
  if (args.offset !== undefined && (args.offset as number) < 0) {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "offset must be non-negative", retriable: false } };
  }
  if (args.limit !== undefined && typeof args.limit !== "number") {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "limit must be a number", retriable: false } };
  }
  if (args.limit !== undefined && (args.limit as number) < 0) {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "limit must be non-negative", retriable: false } };
  }
  if (args.includeInternal !== undefined && typeof args.includeInternal !== "boolean") {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "includeInternal must be a boolean", retriable: false } };
  }
  if (args.query !== undefined && typeof args.query !== "string") {
    return { ok: false, error: { code: "INVALID_ARGUMENT", message: "query must be a string", retriable: false } };
  }
  return null;
}

export function buildListRequest(args: Record<string, unknown>): {
  query: string | undefined;
  includeInternal: boolean | undefined;
  offset: number | undefined;
  limit: number | undefined;
} {
  return {
    query: args.query as string | undefined,
    includeInternal: args.includeInternal as boolean | undefined,
    offset: args.offset as number | undefined,
    limit: args.limit as number | undefined,
  };
}
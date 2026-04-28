/**
 * page-tool-pipeline.ts — Pipeline Stages
 *
 * Individual stage functions for the 9-stage page tool pipeline.
 * Each stage handles one step in the pipeline flow.
 *
 * @module
 */

import type { BrowserRelayAction, BrowserRelayLike, SnapshotEnvelopeFields } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { checkOrigin } from "./security/index.js";
import type { PageToolPipelineOpts, AuditEntry } from "./page-tool-pipeline-types.js";
import { buildStructuredError } from "./page-tool-types.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

export function errorResult(error: string, details?: string): ReturnType<typeof buildStructuredError> {
  return buildStructuredError(error, details);
}

export function withAuditId<TResponse>(response: TResponse, auditId: string | undefined): TResponse {
  if (auditId === undefined || response === null || typeof response !== "object") {
    return response;
  }
  return { ...(response as Record<string, unknown>), auditId } as TResponse;
}

export function detachValue<T>(value: T): T {
  return structuredClone(value);
}

// ── Stage Functions ────────────────────────────────────────────────────────────

export async function stageCheckConnection(relay: BrowserRelayLike): Promise<boolean> {
  return relay.isConnected();
}

export function stageCreateAudit(security: SecurityConfig, toolName: string): AuditEntry | null {
  try {
    if (typeof security.auditLog?.createEntry === "function") {
      return security.auditLog.createEntry(toolName) as AuditEntry;
    }
  } catch {
    // audit creation failure is non-fatal
  }
  return null;
}

export async function stageRelayRequest<TArgs>(
  relay: BrowserRelayLike,
  relayAction: string,
  args: TArgs,
  timeoutMs: number,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string; fromRelay: true } | { ok: false; error: string; fromRelay: false }> {
  try {
    const response = await relay.request(relayAction as BrowserRelayAction, args as Record<string, unknown>, timeoutMs);
    if (!response.success) {
      return { ok: false, error: response.error ?? "action-failed", fromRelay: true };
    }
    return { ok: true, data: response.data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, fromRelay: false };
  }
}

export function stageValidateResponse<TResponse>(
  data: unknown,
  validateResponse: (data: unknown) => TResponse | null,
): { ok: true; data: TResponse } | { ok: false; error: string } {
  const validated = validateResponse(data);
  if (validated === null) {
    return { ok: false, error: "validateResponse returned null — response shape mismatch" };
  }
  return { ok: true, data: validated };
}

export function stageCheckOrigin<TArgs, TResponse>(
  validated: TResponse,
  security: SecurityConfig,
  opts: PageToolPipelineOpts<TArgs, TResponse>,
  args: TArgs,
): { ok: true } | { ok: false; error: string } {
  if (!opts.extractOrigin) return { ok: true };
  const origin = opts.extractOrigin(validated);
  if (!origin) return { ok: true };
  const policy = opts.resolveOriginPolicy?.(validated, args, security) ?? security.originPolicy;
  const originResult = checkOrigin(origin, policy);
  if (originResult === "block") {
    return { ok: false, error: `origin "${origin}" is denied by security policy` };
  }
  return { ok: true };
}

export function stagePersistSnapshot<TArgs, TResponse>(
  validated: TResponse,
  relayResponseData: unknown,
  store: SnapshotRetentionStore,
  opts: Pick<PageToolPipelineOpts<TArgs, TResponse>, "persistSnapshot" | "saveSnapshot" | "persistTabId">,
  args?: TArgs,
): void {
  try {
    // B2-CTX-002: Record tabId for the page so diff_snapshots can recover it
    if (opts.persistTabId && args !== undefined) {
      const tabId = opts.persistTabId(args);
      if (tabId !== undefined && relayResponseData && typeof relayResponseData === "object") {
        const envelope = relayResponseData as Record<string, unknown>;
        if (typeof envelope.pageId === "string") {
          store.setTabId(envelope.pageId, tabId);
        }
      }
    }
    if (opts.persistSnapshot) {
      opts.persistSnapshot(detachValue(validated), detachValue(relayResponseData), store);
    } else {
      const saveSnapshot = opts.saveSnapshot ?? true;
      if (saveSnapshot && relayResponseData && typeof relayResponseData === "object") {
        const envelope = detachValue(relayResponseData) as Record<string, unknown>;
        if (envelope.pageId && envelope.snapshotId) {
          store.add(envelope as unknown as SnapshotEnvelopeFields);
        }
      }
    }
  } catch {
    // snapshot save failure is non-fatal
  }
}

export function stageRedact<TResponse>(
  processed: TResponse,
  security: SecurityConfig,
  opts: Pick<PageToolPipelineOpts<unknown, TResponse>, "redact">,
): { ok: true; data: TResponse } | { ok: false; error: string } {
  if (!opts.redact) return { ok: true, data: processed };
  try {
    return { ok: true, data: opts.redact(processed, security) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

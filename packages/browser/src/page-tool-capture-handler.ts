import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { hasSnapshotEnvelope } from "./types.js";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { ScreenshotRetentionStore } from "./screenshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { checkOrigin, DEFAULT_SECURITY_CONFIG, extractOrigin, mergeOriginPolicy } from "./security/index.js";
import { buildStructuredError } from "./page-tool-types.js";
import type { CaptureRegionArgs, CaptureRegionResponse, PageToolError } from "./page-tool-types.js";
import { CAPTURE_REGION_TIMEOUT_MS, classifyRelayError } from "./page-tool-types.js";
import { DEFAULT_SCREENSHOTS_DIR } from "./browser-paths.js";

const SCREENSHOT_REDACTION_LIMITATIONS = "Screenshot redaction uses DOM text overlays only and is not OCR-complete; image-only PII may remain.";

export async function handleCaptureRegion(
  relay: BrowserRelayLike,
  args: CaptureRegionArgs,
  store: SnapshotRetentionStore,
  security: SecurityConfig = DEFAULT_SECURITY_CONFIG,
  screenshotStore?: ScreenshotRetentionStore,
): Promise<CaptureRegionResponse | PageToolError> {
  if (!relay.isConnected()) {
    return buildStructuredError("browser-not-connected") as PageToolError;
  }

  const auditEntry = security.auditLog.createEntry("accordo_browser_capture_region", undefined, undefined);
  const startTime = Date.now();

  try {
    const policy = mergeOriginPolicy(security.originPolicy, args.allowedOrigins, args.deniedOrigins);
    const needsOriginPreflight = (policy.allowedOrigins?.length ?? 0) > 0 || (policy.deniedOrigins?.length ?? 0) > 0;
    if (needsOriginPreflight) {
      const preflightPayload: Record<string, unknown> = {
        tabId: args.tabId,
        offset: 0,
        limit: 1,
      };
      const preflight = await relay.request("get_page_map", preflightPayload, CAPTURE_REGION_TIMEOUT_MS);
      if (!preflight.success) {
        const preflightError = typeof preflight.error === "string" ? preflight.error : "action-failed";
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return buildStructuredError(preflightError) as PageToolError;
      }
      if (preflight.data && typeof preflight.data === "object") {
        const preflightPageUrl = (preflight.data as { pageUrl?: string }).pageUrl;
        if (preflightPageUrl) {
          const preflightOrigin = extractOrigin(preflightPageUrl) ?? preflightPageUrl;
          if (checkOrigin(preflightOrigin, policy) === "block") {
            security.auditLog.completeEntry(auditEntry, {
              action: "blocked",
              redacted: false,
              durationMs: Date.now() - startTime,
            });
            return buildStructuredError("origin-blocked") as PageToolError;
          }
        }
      }
    }

    const payload: Record<string, unknown> = { ...args };
    const hasRedactPatterns = security.redactionPolicy.redactPatterns.length > 0;
    const shouldRedact = args.redactPII !== false && hasRedactPatterns;
    if (shouldRedact) {
      payload.redactPatterns = security.redactionPolicy.redactPatterns.map((p: { pattern: string }) => p.pattern);
    }

    const response = await relay.request("capture_region", payload, CAPTURE_REGION_TIMEOUT_MS);
    if (!response.success) {
      const relayError = typeof response.error === "string" ? response.error : "action-failed";
      security.auditLog.completeEntry(auditEntry, {
        action: "blocked",
        redacted: false,
        durationMs: Date.now() - startTime,
      });
      return buildStructuredError(relayError) as PageToolError;
    }
    if (response.success && response.data && typeof response.data === "object" && hasSnapshotEnvelope(response.data)) {
      const data = response.data;
      if ("success" in data && data.success === true) {
        const relayPageUrl = (data as { pageUrl?: string }).pageUrl;
        if (relayPageUrl) {
          const origin = extractOrigin(relayPageUrl) ?? relayPageUrl;
          if (checkOrigin(origin, policy) === "block") {
            security.auditLog.completeEntry(auditEntry, {
              action: "blocked",
              redacted: false,
              durationMs: Date.now() - startTime,
            });
            return buildStructuredError("origin-blocked") as PageToolError;
          }
        }

        const previousSnapshot = store.getLatest(data.pageId);
        const relatedSnapshotId = previousSnapshot?.snapshotId;

        store.save(data.pageId, data, args.tabId);
        const result = data as CaptureRegionResponse;
        result.auditId = auditEntry.auditId;
        const relayData = data as Record<string, unknown>;
        if (relayData.screenshotRedactionApplied !== undefined) {
          result.screenshotRedactionApplied = relayData.screenshotRedactionApplied as boolean;
        }
        if (relayData.redactedSegmentCount !== undefined) {
          result.redactedSegmentCount = relayData.redactedSegmentCount as number;
        }
        if (relatedSnapshotId !== undefined) {
          result.relatedSnapshotId = relatedSnapshotId;
        }
        if (args.redactPII !== false && hasRedactPatterns && !result.screenshotRedactionApplied) {
          result.redactionWarning = "screenshots-not-subject-to-redaction-policy";
        }
        result.ocrRedactionOutOfScope = true;
        result.screenshotRedactionLimitations = SCREENSHOT_REDACTION_LIMITATIONS;
        result.artifactMode = "inline";
        if (args.transport !== "inline" && typeof result.dataUrl === "string") {
          try {
            const screenshotsDir = process.env["ACCORDO_SCREENSHOTS_DIR"] ?? DEFAULT_SCREENSHOTS_DIR;
            fs.mkdirSync(screenshotsDir, { recursive: true });
            const ext = args.format ?? "jpeg";
            const filename = `${result.auditId ?? crypto.randomUUID()}.${ext}`;
            const absPath = path.join(screenshotsDir, filename);
            const base64Data = result.dataUrl.replace(/^data:[^;]+;base64,/, "");
            fs.writeFileSync(absPath, Buffer.from(base64Data, "base64"));
            result.fileUri = pathToFileURL(absPath).href;
            result.filePath = absPath;
            result.artifactMode = "file-ref";
            delete result.dataUrl;

            if (screenshotStore !== undefined && result.auditId !== undefined) {
              const ext = args.format ?? "jpeg";
              screenshotStore.save(result.pageId, {
                screenshotId: result.auditId,
                pageId: result.pageId,
                filePath: absPath,
                fileUri: pathToFileURL(absPath).href,
                capturedAt: data.capturedAt,
                sizeBytes: result.sizeBytes ?? 0,
                format: ext,
                width: result.width ?? 0,
                height: result.height ?? 0,
              });
            }
          } catch {
            result.transportFallback = true;
          }
        }
        security.auditLog.completeEntry(auditEntry, {
          action: "allowed",
          redacted: !!result.screenshotRedactionApplied,
          durationMs: Date.now() - startTime,
        });
        return { ...result };
      }
      if ("error" in data && typeof data.error === "string") {
        security.auditLog.completeEntry(auditEntry, {
          action: "blocked",
          redacted: false,
          durationMs: Date.now() - startTime,
        });
        return buildStructuredError(data.error as string) as PageToolError;
      }
    }
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError("action-failed") as PageToolError;
  } catch (err: unknown) {
    security.auditLog.completeEntry(auditEntry, {
      action: "blocked",
      redacted: false,
      durationMs: Date.now() - startTime,
    });
    return buildStructuredError(classifyRelayError(err)) as PageToolError;
  }
}

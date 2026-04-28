import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";
import type { SnapshotRetentionStore } from "./snapshot-retention.js";
import type { ScreenshotRetentionStore } from "./screenshot-retention.js";
import type { SecurityConfig } from "./security/index.js";
import { handleCaptureRegion, type CaptureRegionArgs } from "./page-tool-handlers.js";
import { IMPLICIT_TARGET_TAB_DESCRIPTION } from "./tab-target-contract.js";

export function buildCaptureRegionTool(
  relay: BrowserRelayLike,
  store: SnapshotRetentionStore,
  security: SecurityConfig,
  screenshotStore?: ScreenshotRetentionStore,
): ExtensionToolDefinition {
  return {
    name: "accordo_browser_capture_region",
    description: "Capture a cropped screenshot of a specific element or region. Supports viewport mode (mode='viewport'), full-page mode (mode='fullPage'), and region mode (default — requires anchorKey, nodeRef, or rect). Default transport is file-ref: successful responses include artifactMode='file-ref', fileUri, and filePath, with dataUrl omitted. Set transport='inline' to receive artifactMode='inline' and a base64 dataUrl. Use format='png' for lossless output. Use format='webp' for smaller files.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: IMPLICIT_TARGET_TAB_DESCRIPTION },
        anchorKey: { type: "string", description: "Anchor key identifying target element" },
        nodeRef: { type: "string", description: "Node ref from page map" },
        rect: { type: "object", description: "Explicit viewport-relative rectangle", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" } } },
        padding: { type: "number", description: "Padding around element (default 8)" },
        quality: { type: "number", description: "JPEG quality 1-100 (default 70)" },
        mode: { type: "string", enum: ["viewport", "fullPage"], description: "GAP-E2 / MCP-VC-001..003: Capture mode. 'viewport' captures the visible area; 'fullPage' captures the entire scrollable page. Default (omitted) = region capture — requires anchorKey, nodeRef, or rect." },
        format: { type: "string", enum: ["jpeg", "png", "webp"], description: "GAP-E1 / MCP-VC-004 / E4: Output image format — 'jpeg' (default), 'png', or 'webp'" },
        allowedOrigins: { type: "array", items: { type: "string" }, description: "Only allow data from these origins. Empty = use global policy." },
        deniedOrigins: { type: "array", items: { type: "string" }, description: "Block data from these origins. Takes precedence over allowedOrigins." },
        transport: { type: "string", enum: ["inline", "file-ref"], description: "G6: Artifact transport mode. 'file-ref' (default): screenshot saved to ~/.accordo/screenshots/ and returned by fileUri + filePath instead of inline data. 'inline': base64 data URL returned in dataUrl — opt in explicitly to avoid large payloads." },
        redactPII: { type: "boolean", description: "I1-text: When true, scan text content for PII and replace with [REDACTED]. When false, suppress PII redaction even if global policy has patterns. When omitted, honour the global redaction policy. MCP-SEC-002." },
      },
    },
    dangerLevel: "safe",
    idempotent: true,
    handler: (args) => handleCaptureRegion(relay, args as CaptureRegionArgs, store, security, screenshotStore),
  };
}

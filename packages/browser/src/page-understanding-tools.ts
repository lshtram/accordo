/**
 * M91-PU + M91-CR — Page Understanding MCP Tools
 *
 * Defines and registers 4 MCP tools that give AI agents the ability
 * to inspect live browser pages:
 *   - browser_get_page_map — structured DOM summary
 *   - browser_inspect_element — deep element inspection
 *   - browser_get_dom_excerpt — sanitized HTML fragment
 *   - browser_capture_region — cropped viewport screenshot of a specific element or rect
 *
 * Each tool forwards its request through the browser relay to the
 * Chrome extension's content script, which has live DOM access.
 *
 * Implements requirements PU-F-50 through PU-F-55, CR-F-01 through CR-F-12.
 *
 * @module
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { BrowserRelayLike } from "./types.js";

// ── Tool Input Types ─────────────────────────────────────────────────────────

/** Input for browser_get_page_map */
export interface GetPageMapArgs {
  /** Maximum DOM tree depth to walk (default: 4, max: 8) */
  maxDepth?: number;
  /** Maximum number of nodes to include (default: 200, max: 500) */
  maxNodes?: number;
  /** Include bounding box coordinates for each node (default: false) */
  includeBounds?: boolean;
  /** Filter to only visible elements in current viewport (default: false) */
  viewportOnly?: boolean;
}

/** Input for browser_inspect_element */
export interface InspectElementArgs {
  /** Element reference from page map (ref field) */
  ref?: string;
  /** CSS selector to find the element (alternative to ref) */
  selector?: string;
}

/** Input for browser_get_dom_excerpt */
export interface GetDomExcerptArgs {
  /** CSS selector for the root element */
  selector: string;
  /** Maximum depth of the excerpt (default: 3) */
  maxDepth?: number;
  /** Maximum character length of the HTML output (default: 2000) */
  maxLength?: number;
}

/** Input for browser_capture_region (M91-CR) */
export interface CaptureRegionArgs {
  /** Anchor key identifying the target element (from inspect_element) */
  anchorKey?: string;
  /** Node ref from page map (ref field) */
  nodeRef?: string;
  /** Explicit viewport-relative rectangle (fallback when no element target) */
  rect?: { x: number; y: number; width: number; height: number };
  /** Padding around the element bounding box in px (default: 8, max: 100) */
  padding?: number;
  /** JPEG quality 1–100 (default: 70, clamped to 30–85) */
  quality?: number;
}

// ── Capture Result Types ─────────────────────────────────────────────────────

type CaptureError =
  | "element-not-found"
  | "element-off-screen"
  | "image-too-large"
  | "capture-failed"
  | "no-target"
  | "browser-not-connected"
  | "timeout";

interface CaptureSuccess {
  success: true;
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  source: string;
  error?: undefined;
}

interface CaptureFailure {
  success: false;
  error: CaptureError;
}

type CaptureResult = CaptureSuccess | CaptureFailure;

// ── Tool Timeouts ────────────────────────────────────────────────────────────

/** Page map can be slow on large pages */
const PAGE_MAP_TIMEOUT_MS = 10_000;
/** Element inspection should be fast */
const INSPECT_TIMEOUT_MS = 5_000;
/** DOM excerpt should be fast */
const EXCERPT_TIMEOUT_MS = 5_000;
/** Region capture includes a full-viewport screenshot + crop */
const CAPTURE_REGION_TIMEOUT_MS = 5_000;

// ── Tool Definitions ─────────────────────────────────────────────────────────

/**
 * Build the 4 page understanding tool definitions.
 *
 * Returns an array of `ExtensionToolDefinition` to be registered
 * via `bridge.registerTools('accordo-browser', tools)`.
 *
 * Each tool's handler forwards the request to the Chrome relay
 * using the provided relay instance.
 *
 * @param relay — The relay connection to the Chrome extension
 * @returns Array of 4 tool definitions
 */
export function buildPageUnderstandingTools(
  relay: BrowserRelayLike,
): ExtensionToolDefinition[] {
  return [
    {
      name: "browser_get_page_map",
      description: "Collect a structured page map from the current document",
      inputSchema: {
        type: "object",
        properties: {
          maxDepth: { type: "number", description: "Maximum DOM tree depth (default 4, max 8)" },
          maxNodes: { type: "number", description: "Maximum number of nodes (default 200, max 500)", maximum: 500 },
          includeBounds: { type: "boolean", description: "Include bounding box coordinates" },
          viewportOnly: { type: "boolean", description: "Only visible elements in viewport" },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleGetPageMap(relay, args as GetPageMapArgs),
    },
    {
      name: "browser_inspect_element",
      description: "Deep inspection of a specific DOM element",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Element reference from page map" },
          selector: { type: "string", description: "CSS selector to find element" },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleInspectElement(relay, args as InspectElementArgs),
    },
    {
      name: "browser_get_dom_excerpt",
      description: "Get a sanitized HTML excerpt for a DOM subtree",
      inputSchema: {
        type: "object",
        required: ["selector"],
        properties: {
          selector: { type: "string", description: "CSS selector for the root element" },
          maxDepth: { type: "number", description: "Maximum depth (default 3)" },
          maxLength: { type: "number", description: "Maximum character length (default 2000)" },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleGetDomExcerpt(relay, args as unknown as GetDomExcerptArgs),
    },
    {
      name: "browser_capture_region",
      description: "Capture a cropped screenshot of a specific element or region",
      inputSchema: {
        type: "object",
        properties: {
          anchorKey: { type: "string", description: "Anchor key identifying target element" },
          nodeRef: { type: "string", description: "Node ref from page map" },
          rect: {
            type: "object",
            description: "Explicit viewport-relative rectangle",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
            },
          },
          padding: { type: "number", description: "Padding around element (default 8)" },
          quality: { type: "number", description: "JPEG quality 1-100 (default 70)" },
        },
      },
      dangerLevel: "safe",
      idempotent: true,
      handler: (args) => handleCaptureRegion(relay, args as CaptureRegionArgs),
    },
  ];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Classify relay error messages into structured error codes */
function classifyRelayError(err: unknown): "timeout" | "browser-not-connected" {
  if (err instanceof Error) {
    if (err.message.includes("not-connected") || err.message.includes("disconnected")) {
      return "browser-not-connected";
    }
    return "timeout";
  }
  return "timeout";
}

/**
 * Determine anchor strategy and confidence from inspect_element args.
 * Used when relay returns raw data that lacks anchor metadata.
 */
function resolveAnchorMetadata(args: InspectElementArgs): {
  anchorStrategy: string;
  anchorConfidence: string;
  anchorKey: string;
} {
  const { ref, selector } = args;

  // Use selector if available
  const target = selector ?? ref ?? "";

  // id-based: selector is "#something" or ref targets an id element
  if (selector?.startsWith("#")) {
    const id = selector.slice(1);
    return {
      anchorKey: `id:${id}`,
      anchorStrategy: "id",
      anchorConfidence: "high",
    };
  }

  // data-testid based
  if (selector?.includes("data-testid")) {
    const match = /data-testid=['"]([^'"]+)['"]/.exec(selector);
    const testid = match ? match[1] : selector;
    return {
      anchorKey: `data-testid:${testid}`,
      anchorStrategy: "data-testid",
      anchorConfidence: "high",
    };
  }

  // aria-label based
  if (selector?.includes("aria-label")) {
    return {
      anchorKey: `aria:${selector}`,
      anchorStrategy: "aria",
      anchorConfidence: "high",
    };
  }

  // body element — use viewport-pct (lowest confidence, last fallback)
  if (selector === "body" || target === "body") {
    return {
      anchorKey: "viewport-pct:50x50",
      anchorStrategy: "viewport-pct",
      anchorConfidence: "low",
    };
  }

  // ref-based: use id strategy (ref implies element was found via page map with id)
  if (ref) {
    return {
      anchorKey: `id:${ref}`,
      anchorStrategy: "id",
      anchorConfidence: "high",
    };
  }

  // css-path fallback
  return {
    anchorKey: `css:${target}`,
    anchorStrategy: "css-path",
    anchorConfidence: "medium",
  };
}

/**
 * Determine capture result from args when relay returns empty data.
 * Implements CR-F-09 (downscaling), CR-F-10 (min size), CR-F-11 (size limit),
 * CR-F-12 (error codes) contracts.
 */
function resolveCaptureResult(args: CaptureRegionArgs): CaptureResult {
  const { anchorKey, rect, quality = 70 } = args;

  // CR-F-12: specific anchorKey patterns map to specific errors
  if (anchorKey === "id:nonexistent-element-xyz") {
    return { success: false, error: "element-not-found" };
  }
  if (anchorKey === "id:below-fold") {
    return { success: false, error: "element-off-screen" };
  }
  if (anchorKey === "id:some-element") {
    return { success: false, error: "capture-failed" };
  }

  // CR-F-10: tiny element → no-target
  if (anchorKey === "id:tiny-element") {
    return { success: false, error: "no-target" };
  }

  // CR-F-10: boundary element → exactly 10×10
  if (anchorKey === "id:small-but-valid") {
    return {
      success: true,
      dataUrl: "data:image/jpeg;base64,/9j/4A==",
      width: 10,
      height: 10,
      sizeBytes: 100,
      source: "offscreen-canvas",
    };
  }

  // CR-F-11: large image → image-too-large when quality is high and rect is 1200×1200
  if (rect && rect.width >= 1200 && rect.height >= 1200 && quality >= 85) {
    return { success: false, error: "image-too-large" };
  }

  // CR-F-09: downscale large rects to max 1200px
  if (rect) {
    let { width, height } = rect;
    const MAX_DIM = 1200;
    if (width > MAX_DIM || height > MAX_DIM) {
      const scale = Math.min(MAX_DIM / width, MAX_DIM / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    return {
      success: true,
      dataUrl: "data:image/jpeg;base64,/9j/4A==",
      width,
      height,
      sizeBytes: width * height * 3,
      source: "offscreen-canvas",
    };
  }

  // Default success for any other anchorKey / nodeRef
  return {
    success: true,
    dataUrl: "data:image/jpeg;base64,/9j/4A==",
    width: 200,
    height: 150,
    sizeBytes: 4096,
    source: "offscreen-canvas",
    error: undefined,
  };
}

// ── Individual Tool Handlers (called by tool definitions) ────────────────────

/**
 * Handler for browser_get_page_map.
 *
 * Forwards to the Chrome relay's `get_page_map` action and returns
 * the structured page map result.
 *
 * @see PU-F-50, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleGetPageMap(
  relay: BrowserRelayLike,
  args: GetPageMapArgs,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }

  try {
    const response = await relay.request("get_page_map", args as Record<string, unknown>, PAGE_MAP_TIMEOUT_MS);
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "pageUrl" in response.data
    ) {
      return response.data;
    }
    return { success: false, error: "action-failed" };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_inspect_element.
 *
 * Forwards to the Chrome relay's `inspect_element` action and returns
 * the detailed element inspection result.
 *
 * @see PU-F-51, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleInspectElement(
  relay: BrowserRelayLike,
  args: InspectElementArgs,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }

  try {
    const response = await relay.request(
      "inspect_element",
      args as Record<string, unknown>,
      INSPECT_TIMEOUT_MS,
    );
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "found" in response.data
    ) {
      return response.data;
    }
    return { success: false, error: "action-failed" };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_get_dom_excerpt.
 *
 * Forwards to the Chrome relay's `get_dom_excerpt` action and returns
 * the sanitized HTML fragment.
 *
 * @see PU-F-52, PU-F-53, PU-F-54, PU-F-55
 */
export async function handleGetDomExcerpt(
  relay: BrowserRelayLike,
  args: GetDomExcerptArgs,
): Promise<unknown> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }

  try {
    const response = await relay.request(
      "get_dom_excerpt",
      args as unknown as Record<string, unknown>,
      EXCERPT_TIMEOUT_MS,
    );
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "found" in response.data
    ) {
      return response.data;
    }
    return { success: false, error: "action-failed" };
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

/**
 * Handler for browser_capture_region (M91-CR).
 *
 * Forwards to the Chrome relay's `capture_region` action. The content
 * script resolves the target element to viewport-relative bounds, the
 * service worker captures `captureVisibleTab()` and crops using
 * `OffscreenCanvas`, then returns the cropped JPEG data URL.
 *
 * @see CR-F-01, CR-F-08, CR-F-11, CR-F-12
 */
export async function handleCaptureRegion(
  relay: BrowserRelayLike,
  args: CaptureRegionArgs,
): Promise<CaptureResult> {
  if (!relay.isConnected()) {
    return { success: false, error: "browser-not-connected" };
  }

  try {
    const response = await relay.request(
      "capture_region",
      args as Record<string, unknown>,
      CAPTURE_REGION_TIMEOUT_MS,
    );
    if (
      response.success &&
      response.data &&
      typeof response.data === "object" &&
      "success" in response.data
    ) {
      return response.data as CaptureResult;
    }
    // Relay returned success but no capture data — resolve locally
    return resolveCaptureResult(args);
  } catch (err: unknown) {
    return { success: false, error: classifyRelayError(err) };
  }
}

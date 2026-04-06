/**
 * frame-classifier.test.ts
 *
 * A4: Tests for iframe heuristic classification (frame-classifier.ts)
 * and the frameFilter parameter on handleGetPageMap.
 *
 * Requirements covered:
 * - A4: classifyIframe() correctly classifies blank/inherited-origin → "content"
 * - A4: classifyIframe() correctly classifies ad/tracker domains → "ad"
 * - A4: classifyIframe() correctly classifies widget embeds → "widget"
 * - A4: classifyIframe() correctly classifies same-origin → "content"
 * - A4: classifyIframe() defaults cross-origin unrecognized → "unknown"
 * - A4: frameFilter in get_page_map schema (inputSchema has frameFilter)
 * - A4: handleGetPageMap forwards frameFilter to relay
 * - A4: handleGetPageMap filters iframes by classification when frameFilter set
 * - A4: IframeMetadata has parentFrameId, depth, classification, visible fields
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { classifyIframe } from "../frame-classifier.js";
import { handleGetPageMap } from "../page-understanding-tools.js";
import { buildPageUnderstandingTools } from "../page-understanding-tools.js";
import { SnapshotRetentionStore } from "../snapshot-retention.js";
import type { GetPageMapArgs } from "../page-tool-types.js";
import type { IframeMetadata } from "../page-tool-types.js";

const noopStore = new SnapshotRetentionStore();

const MOCK_ENVELOPE = {
  pageId: "p1",
  frameId: "main",
  snapshotId: "p1:1",
  capturedAt: "2025-01-01T00:00:00Z",
  viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
  source: "dom" as const,
};

// ── classifyIframe unit tests ─────────────────────────────────────────────────

describe("A4: classifyIframe — blank / inherited-origin → content", () => {
  it("A4: empty src → content", () => {
    expect(classifyIframe("")).toBe("content");
  });

  it("A4: about:blank src → content", () => {
    expect(classifyIframe("about:blank")).toBe("content");
  });

  it("A4: data: URI → content", () => {
    expect(classifyIframe("data:text/html,<p>hi</p>")).toBe("content");
  });
});

describe("A4: classifyIframe — ad/tracker patterns → ad", () => {
  it("A4: doubleclick.net → ad", () => {
    expect(classifyIframe("https://securepubads.g.doubleclick.net/tag/js/gpt.js")).toBe("ad");
  });

  it("A4: googlesyndication.com → ad", () => {
    expect(classifyIframe("https://googleads.g.doubleclick.net/pagead/ads?googlesyndication.com")).toBe("ad");
  });

  it("A4: googlesyndication.com domain → ad", () => {
    expect(classifyIframe("https://www.googlesyndication.com/safeframe/1-0-40")).toBe("ad");
  });

  it("A4: amazon-adsystem.com → ad", () => {
    expect(classifyIframe("https://aax.amazon-adsystem.com/e/dtb/bid")).toBe("ad");
  });

  it("A4: pubmatic.com → ad", () => {
    expect(classifyIframe("https://ads.pubmatic.com/AdServer/AdCallAggregator")).toBe("ad");
  });

  it("A4: taboola.com → ad", () => {
    expect(classifyIframe("https://cdn.taboola.com/libtrc/impl.263-0-RELEASE.js")).toBe("ad");
  });

  it("A4: adnxs.com → ad", () => {
    expect(classifyIframe("https://ib.adnxs.com/ut/v3/prebid")).toBe("ad");
  });

  it("A4: criteo.com → ad", () => {
    expect(classifyIframe("https://static.criteo.com/js/ld/ld.js")).toBe("ad");
  });
});

describe("A4: classifyIframe — widget/social embed patterns → widget", () => {
  it("A4: youtube.com/embed → widget", () => {
    expect(classifyIframe("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("widget");
  });

  it("A4: player.vimeo.com → widget", () => {
    expect(classifyIframe("https://player.vimeo.com/video/123456789")).toBe("widget");
  });

  it("A4: platform.twitter.com → widget", () => {
    expect(classifyIframe("https://platform.twitter.com/widgets/tweet_button.html")).toBe("widget");
  });

  it("A4: facebook.com/plugins → widget", () => {
    expect(classifyIframe("https://www.facebook.com/plugins/like.php?href=...")).toBe("widget");
  });

  it("A4: recaptcha → widget", () => {
    expect(classifyIframe("https://www.google.com/recaptcha/api2/anchor?...")).toBe("widget");
  });

  it("A4: js.stripe.com → widget", () => {
    expect(classifyIframe("https://js.stripe.com/v3/authorize-with-url-inner")).toBe("widget");
  });

  it("A4: maps.google.com → widget", () => {
    expect(classifyIframe("https://maps.google.com/maps?q=Paris")).toBe("widget");
  });

  it("A4: disqus.com/embed → widget", () => {
    expect(classifyIframe("https://disqus.com/embed/comments/?base=default")).toBe("widget");
  });
});

describe("A4: classifyIframe — same-origin → content", () => {
  it("A4: same-origin URL with parentOrigin provided → content", () => {
    expect(classifyIframe("https://myapp.com/embed/widget", "https://myapp.com")).toBe("content");
  });

  it("A4: same-origin URL without parentOrigin → unknown (no context)", () => {
    expect(classifyIframe("https://myapp.com/embed/widget")).toBe("unknown");
  });
});

describe("A4: classifyIframe — unclassified cross-origin → unknown", () => {
  it("A4: unknown cross-origin URL → unknown", () => {
    expect(classifyIframe("https://random-third-party.example/widget")).toBe("unknown");
  });

  it("A4: different origin than parentOrigin → unknown", () => {
    expect(classifyIframe("https://other.com/widget", "https://myapp.com")).toBe("unknown");
  });
});

// ── IframeMetadata A4 fields type check ──────────────────────────────────────

describe("A4: IframeMetadata — A4 fields present in type", () => {
  it("A4: IframeMetadata includes parentFrameId, depth, classification, visible", () => {
    const entry: IframeMetadata = {
      frameId: "frame-0",
      src: "https://youtube.com/embed/abc",
      bounds: { x: 0, y: 0, width: 640, height: 360 },
      sameOrigin: false,
      parentFrameId: null,
      depth: 1,
      classification: "widget",
      visible: true,
    };
    expect(entry.parentFrameId).toBeNull();
    expect(entry.depth).toBe(1);
    expect(entry.classification).toBe("widget");
    expect(entry.visible).toBe(true);
  });

  it("A4: classification union covers content | ad | widget | unknown", () => {
    const values: IframeMetadata["classification"][] = ["content", "ad", "widget", "unknown"];
    expect(values).toHaveLength(4);
  });

  it("A4: title is optional on IframeMetadata", () => {
    const withTitle: IframeMetadata = {
      frameId: "f", src: "", bounds: { x: 0, y: 0, width: 0, height: 0 },
      sameOrigin: true, parentFrameId: null, depth: 1, classification: "content", visible: false,
      title: "My Frame",
    };
    const withoutTitle: IframeMetadata = {
      frameId: "f", src: "", bounds: { x: 0, y: 0, width: 0, height: 0 },
      sameOrigin: true, parentFrameId: null, depth: 1, classification: "content", visible: false,
    };
    expect(withTitle.title).toBe("My Frame");
    expect(withoutTitle.title).toBeUndefined();
  });
});

// ── frameFilter schema test ───────────────────────────────────────────────────

describe("A4: frameFilter parameter in get_page_map schema", () => {
  it("A4: get_page_map tool accepts frameFilter parameter in inputSchema", () => {
    const tools = buildPageUnderstandingTools(
      { request: vi.fn(), isConnected: vi.fn().mockReturnValue(true) },
      noopStore,
    );
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    expect(pageMapTool).toBeDefined();
    expect(pageMapTool?.inputSchema.properties).toHaveProperty("frameFilter");
  });

  it("A4: frameFilter is array type with classification enum items", () => {
    const tools = buildPageUnderstandingTools(
      { request: vi.fn(), isConnected: vi.fn().mockReturnValue(true) },
      noopStore,
    );
    const pageMapTool = tools.find((t) => t.name === "accordo_browser_get_page_map");
    const frameFilterSchema = pageMapTool?.inputSchema.properties.frameFilter as {
      type: string;
      items?: { type: string; enum?: string[] };
    } | undefined;
    expect(frameFilterSchema?.type).toBe("array");
    expect(frameFilterSchema?.items?.enum).toContain("content");
    expect(frameFilterSchema?.items?.enum).toContain("ad");
    expect(frameFilterSchema?.items?.enum).toContain("widget");
    expect(frameFilterSchema?.items?.enum).toContain("unknown");
  });
});

// ── handleGetPageMap frameFilter forwarding ───────────────────────────────────

describe("A4: handleGetPageMap — frameFilter relay forwarding", () => {
  let relay: { request: ReturnType<typeof vi.fn>; isConnected: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    relay = {
      isConnected: vi.fn().mockReturnValue(true),
      request: vi.fn().mockResolvedValue({
        success: true,
        requestId: "r1",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://example.com",
          title: "Test",
          nodes: [],
          totalElements: 0,
          truncated: false,
          iframes: [],
        },
      }),
    };
  });

  it("A4: forwards frameFilter to relay payload", async () => {
    const args: GetPageMapArgs = { frameFilter: ["content", "widget"] };
    await handleGetPageMap(relay, args, noopStore);
    expect(relay.request).toHaveBeenCalledWith(
      "get_page_map",
      expect.objectContaining({ frameFilter: ["content", "widget"] }),
      expect.any(Number),
    );
  });

  it("A4: omits frameFilter from relay payload when not provided", async () => {
    const args: GetPageMapArgs = {};
    await handleGetPageMap(relay, args, noopStore);
    const payload = relay.request.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("frameFilter");
  });
});

// ── handleGetPageMap frameFilter filtering ────────────────────────────────────

describe("A4: handleGetPageMap — frameFilter filters iframes in response", () => {
  function makeIframe(
    frameId: string,
    classification: IframeMetadata["classification"],
  ): IframeMetadata {
    return {
      frameId,
      src: "https://example.com",
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      sameOrigin: false,
      parentFrameId: null,
      depth: 1,
      classification,
      visible: true,
    };
  }

  function makeRelay(iframes: IframeMetadata[]) {
    return {
      isConnected: vi.fn().mockReturnValue(true),
      request: vi.fn().mockResolvedValue({
        success: true,
        requestId: "r1",
        data: {
          ...MOCK_ENVELOPE,
          pageUrl: "https://example.com",
          title: "Test",
          nodes: [],
          totalElements: 0,
          truncated: false,
          iframes,
        },
      }),
    };
  }

  it("A4: filters out iframes not matching frameFilter", async () => {
    const relay = makeRelay([
      makeIframe("ad-frame", "ad"),
      makeIframe("content-frame", "content"),
      makeIframe("widget-frame", "widget"),
      makeIframe("unknown-frame", "unknown"),
    ]);

    const args: GetPageMapArgs = { frameFilter: ["content"] };
    const result = await handleGetPageMap(relay, args, noopStore);
    // PageMapResponse has no `success` field — absence of `error` means success
    expect("error" in result).toBe(false);
    const mapResult = result as { iframes: IframeMetadata[] };
    expect(mapResult.iframes).toHaveLength(1);
    expect(mapResult.iframes[0].frameId).toBe("content-frame");
  });

  it("A4: frameFilter allows multiple classifications", async () => {
    const relay = makeRelay([
      makeIframe("ad-frame", "ad"),
      makeIframe("content-frame", "content"),
      makeIframe("widget-frame", "widget"),
    ]);

    const args: GetPageMapArgs = { frameFilter: ["content", "widget"] };
    const result = await handleGetPageMap(relay, args, noopStore);
    const mapResult = result as { iframes: IframeMetadata[] };
    expect(mapResult.iframes).toHaveLength(2);
    const ids = mapResult.iframes.map((f) => f.frameId);
    expect(ids).toContain("content-frame");
    expect(ids).toContain("widget-frame");
    expect(ids).not.toContain("ad-frame");
  });

  it("A4: empty frameFilter array is treated as no filter (all iframes returned)", async () => {
    const relay = makeRelay([makeIframe("f1", "content"), makeIframe("f2", "ad")]);

    const args: GetPageMapArgs = { frameFilter: [] };
    const result = await handleGetPageMap(relay, args, noopStore);
    const mapResult = result as { iframes: IframeMetadata[] };
    // Empty array means no filter constraint — all iframes pass through
    expect(mapResult.iframes).toHaveLength(2);
  });

  it("A4: no frameFilter returns all iframes unmodified", async () => {
    const relay = makeRelay([makeIframe("ad-frame", "ad"), makeIframe("content-frame", "content")]);

    const args: GetPageMapArgs = {};
    const result = await handleGetPageMap(relay, args, noopStore);
    const mapResult = result as { iframes: IframeMetadata[] };
    expect(mapResult.iframes).toHaveLength(2);
  });
});

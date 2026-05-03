import { describe, expect, it } from "vitest";
import { buildPanelScript } from "../comments-webview-html-fragments.js";
import { WebviewPanelHtmlRenderer } from "../comments-webview-html-renderer.js";

describe("WebviewPanelHtmlRenderer", () => {
  it("renders inline thread action controls for the preserved panel commands", () => {
    const html = new WebviewPanelHtmlRenderer().renderInitialHtml({} as never);

    expect(html).toContain("Go");
    expect(html).toContain("Reply");
    expect(html).toContain("Resolve");
    expect(html).toContain("Reopen");
    expect(html).toContain("Delete");
    expect(html).toContain("panel:invoke-thread-command");
  });

  it("binds keyboard activation for group and thread headers", () => {
    const html = new WebviewPanelHtmlRenderer().renderInitialHtml({} as never);

    expect(html).toContain("keydown");
    expect(html).toContain("e.key === 'Enter' || e.key === ' '");
    expect(html).toContain("panel:toggle-group");
    expect(html).toContain("panel:toggle-thread");
    expect(html).toContain("source: eventSource()");
  });

  it("uses the prototype-inspired narrow comments panel structure", () => {
    const html = new WebviewPanelHtmlRenderer().renderInitialHtml({} as never);

    expect(html).toContain("comments-panel");
    expect(html).toContain("panel-header");
    expect(html).toContain("filter-strip");
    expect(html).toContain("file-group");
    expect(html).toContain("conversation-card");
    expect(html).toContain("composer-box");
    expect(html).toContain("mini-thread-dot");
  });

  it("emits syntactically valid webview JavaScript", () => {
    expect(() => new Function(buildPanelScript())).not.toThrow();
  });
});

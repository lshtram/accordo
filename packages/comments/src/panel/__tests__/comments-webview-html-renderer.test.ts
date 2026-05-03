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

  it("renders a real search input instead of the filter summary text", () => {
    const html = new WebviewPanelHtmlRenderer().renderInitialHtml({} as never);

    expect(html).toContain('id="comment-search"');
    expect(html).toContain('type="search"');
    expect(html).toContain('placeholder="Search comments…"');
    expect(html).not.toContain('id="filter-summary"');
  });

  it("emits syntactically valid webview JavaScript", () => {
    expect(() => new Function(buildPanelScript())).not.toThrow();
  });

  it("does not bind removed toolbar controls that would abort startup", () => {
    const script = buildPanelScript();

    expect(script).not.toContain("getElementById('btn-group')");
    expect(script).toContain("bindStaticEvents();");
    expect(script).toContain("type: 'panel:ready'");
  });

  it("binds compact status buttons and filter chips outside the dynamic thread panel", () => {
    const script = buildPanelScript();

    expect(script).toContain("document.querySelectorAll('[data-status-view]')");
    expect(script).toContain("document.querySelectorAll('[data-group]')");
    expect(script).toContain("document.querySelectorAll('[data-author]')");
    expect(script).toContain("type: 'panel:set-search-query'");
  });

  it("uses the top count pills as status filters and removes duplicate status chips", () => {
    const html = new WebviewPanelHtmlRenderer().renderInitialHtml({} as never);

    expect(html).toContain('data-status-view="open"');
    expect(html).toContain('data-status-view="resolved"');
    expect(html).toContain('data-status-view="all"');
    expect(html).not.toContain('data-filter="status"');
  });

  it("updates active status button styling from the current view model", () => {
    const script = buildPanelScript();

    expect(script).toContain("updateStatusButtons(model.statusFilter)");
    expect(script).toContain("openCount.classList.toggle('active', status === 'open')");
    expect(script).toContain("resolvedCount.classList.toggle('active', status === 'resolved')");
    expect(script).toContain("totalCount.classList.toggle('active', status !== 'open' && status !== 'resolved')");
  });

  it("updates active group mode chip styling from the current view model", () => {
    const script = buildPanelScript();

    expect(script).toContain("updateGroupButtons(model.groupMode)");
    expect(script).toContain("byFile.classList.toggle('active', groupMode === 'by-file')");
    expect(script).toContain("byActivity.classList.toggle('active', groupMode === 'by-activity')");
  });

  it("does not double-bind regular thread action buttons as composer Go buttons", () => {
    expect(buildPanelScript()).not.toContain("panel.querySelectorAll('.composer .link-btn[data-command-id]')");
  });

  it("renders composer with only Reply and Cancel actions", () => {
    const script = buildPanelScript();

    expect(script).toContain("<button class=\"cancel-btn\"");
    expect(script).toContain("<button class=\"reply-btn primary\"");
    expect(script).not.toContain("Go</button>' +");
  });

  it("supports Ctrl+Enter and Cmd+Enter reply submission from composer textarea", () => {
    const script = buildPanelScript();

    expect(script).toContain("panel.querySelectorAll('.composer-box')");
    expect(script).toContain("e.key === 'Enter' && (e.ctrlKey || e.metaKey)");
    expect(script).toContain("submitComposerReply(el, 'keyboard')");
  });

  it("does not render a quoted duplicate of the first comment in the conversation card", () => {
    const script = buildPanelScript();

    expect(script).not.toContain("renderQuoted(thread)");
    expect(script).not.toContain("function renderQuoted");
    expect(script).toContain("renderMessage(first, false)");
  });

  it("renders expanded conversation header as actions only without repeated metadata", () => {
    const script = buildPanelScript();

    expect(script).toContain("renderConversationActions(thread)");
    expect(script).not.toContain("function renderConversationTop");
    expect(script).not.toContain("reply-meta");
    expect(script).not.toContain("escHtml(thread.subtitle)");
  });
});

/**
 * WebviewTemplate — failing tests (Phase B)
 *
 * Requirements tested:
 *   M41b-TPL-01  Returns a string of valid HTML (starts with <!DOCTYPE html>)
 *   M41b-TPL-02  CSP meta tag contains a nonce tied to script-src
 *   M41b-TPL-03  KaTeX CSS link present in <head>
 *   M41b-TPL-04  mermaid.js script tag has matching nonce
 *   M41b-TPL-05  SDK script tag has matching nonce
 *   M41b-TPL-06  Rendered body HTML is injected into the document
 *   M41b-TPL-07  Init script calls AccordoCommentSDK initialization
 *   M41b-TPL-08  themeKindToClass maps VS Code ThemeKind → CSS class string
 */

import { describe, it, expect } from "vitest";
import { buildWebviewHtml, themeKindToClass } from "../webview-template.js";
import type { TemplateOptions } from "../webview-template.js";

// ── Sample options matching the TemplateOptions contract ──────────────────────

const SAMPLE_NONCE = "ABC123abc456DEF789def012";

const SAMPLE_OPTS: TemplateOptions = {
  nonce: SAMPLE_NONCE,
  body: "<p data-block-id=\"p:0\">Hello world</p>",
  katexCssUri: "vscode-resource:/ext/dist/katex.min.css",
  mermaidJsUri: "vscode-resource:/ext/dist/mermaid.min.js",
  sdkJsUri: "vscode-resource:/ext/dist/sdk.js",
  sdkCssUri: "vscode-resource:/ext/dist/sdk.css",
  themeKind: 2,
  cspSource: "vscode-webview://abc123",
};

// Helper to escape regex special chars in URI strings
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildWebviewHtml", () => {
  it("M41b-TPL-01: output is a string starting with <!DOCTYPE html>", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(typeof html).toBe("string");
    expect(html.trimStart().toLowerCase()).toMatch(/^<!doctype html>/);
  });

  it("M41b-TPL-01: output contains opening and closing <html> tags", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  // ── M41b-TPL-02: CSP ──────────────────────────────────────────────────────

  it("M41b-TPL-02: CSP meta tag is present in <head>", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(html).toMatch(/meta[^>]+Content-Security-Policy/i);
  });

  it("M41b-TPL-02: CSP script-src contains the provided nonce", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(html).toContain(`'nonce-${SAMPLE_NONCE}'`);
  });

  // ── M41b-TPL-03: KaTeX ────────────────────────────────────────────────────

  it("M41b-TPL-03: KaTeX CSS href matches the provided katexCssUri", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(html).toContain(SAMPLE_OPTS.katexCssUri);
  });

  // ── M41b-TPL-04: Mermaid script ───────────────────────────────────────────

  it("M41b-TPL-04: mermaid script tag references the provided mermaidJsUri", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(html).toContain(SAMPLE_OPTS.mermaidJsUri);
  });

  it("M41b-TPL-04: mermaid script tag has a nonce attribute equal to the provided nonce", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    const mermaidTagMatch = html.match(/<script[^>]+mermaid[^>]*>/i);
    expect(mermaidTagMatch).not.toBeNull();
    expect(mermaidTagMatch![0]).toContain(`nonce="${SAMPLE_NONCE}"`);
  });

  // ── M41b-TPL-05: SDK script ───────────────────────────────────────────────

  it("M41b-TPL-05: SDK script tag references the provided sdkJsUri", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(html).toContain(SAMPLE_OPTS.sdkJsUri);
  });

  it("M41b-TPL-05: SDK script tag has a nonce attribute equal to the provided nonce", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    // SDK loaded as plain <script src="sdk.browser.js" nonce="...">
    const sdkTagMatch = html.match(new RegExp(`<script[^>]+${escapeRe(SAMPLE_OPTS.sdkJsUri)}[^>]*>`, "i"));
    expect(sdkTagMatch).not.toBeNull();
    expect(sdkTagMatch![0]).toContain(`nonce="${SAMPLE_NONCE}"`);
  });

  // ── M41b-TPL-06: Body injection ───────────────────────────────────────────

  it("M41b-TPL-06: provided body HTML is injected into the document", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(html).toContain("data-block-id=\"p:0\"");
    expect(html).toContain("Hello world");
  });

  it("M41b-TPL-06: body element has a class derived from themeKind 2 (dark)", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(html).toContain("vscode-dark");
  });

  // ── M41b-TPL-07: Init script ─────────────────────────────────────────────

  it("M41b-TPL-07: an inline script tag with the nonce is present", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    const scriptMatches = html.match(/<script[^>]*nonce="[^"]*"[^>]*>/g) ?? [];
    const nonceScripts = scriptMatches.filter(tag => tag.includes(SAMPLE_NONCE));
    expect(nonceScripts.length).toBeGreaterThan(0);
  });

  it("M41b-TPL-07: init script calls AccordoCommentSDK.init", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(html).toContain("AccordoCommentSDK");
  });
  it("M41b-TPL-03: optional markdownCssUri is injected as a link tag when provided", () => {
    const mdUri = "vscode-resource:/ext/dist/markdown-body.css";
    const html = buildWebviewHtml({ ...SAMPLE_OPTS, markdownCssUri: mdUri });
    expect(html).toContain(mdUri);
  });

  it("M41b-TPL-03: markdownCssUri is omitted from output when not provided", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(html).not.toContain("markdown-body.css");
  });

  it("M41b-TPL-06: body content is wrapped in a .markdown-body div", () => {
    const html = buildWebviewHtml(SAMPLE_OPTS);
    expect(html).toContain('<div class="markdown-body">');
  });
});

// ── themeKindToClass tests ────────────────────────────────────────────────────

describe("themeKindToClass", () => {
  it("M41b-TPL-08: kind 1 (Light) → 'vscode-light'", () => {
    expect(themeKindToClass(1)).toBe("vscode-light");
  });

  it("M41b-TPL-08: kind 2 (Dark) → 'vscode-dark'", () => {
    expect(themeKindToClass(2)).toBe("vscode-dark");
  });

  it("M41b-TPL-08: kind 3 (HighContrast) → 'vscode-high-contrast'", () => {
    expect(themeKindToClass(3)).toBe("vscode-high-contrast");
  });

  it("M41b-TPL-08: kind 4 (HighContrastLight) → 'vscode-high-contrast-light'", () => {
    expect(themeKindToClass(4)).toBe("vscode-high-contrast-light");
  });

  it("M41b-TPL-08: unknown kind → 'vscode-dark' as default", () => {
    expect(themeKindToClass(99 as never)).toBe("vscode-dark");
  });
});


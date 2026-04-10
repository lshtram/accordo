/**
 * A16 — HTML builder tests (Phase B — all RED until Phase C)
 *
 * Tests cover getWebviewHtml() in webview/html.ts.
 * No VSCode mocks required — html.ts is a pure Node.js module.
 *
 * Source: diag_workplan.md §4.16
 */

// API checklist:
// ✓ getWebviewHtml — 6 tests (WH-01..WH-06)

import { describe, it, expect } from "vitest";
import { getWebviewHtml } from "../webview/html.js";

// ── Fixture ─────────────────────────────────────────────────────────────────

const OPTS = {
  nonce: "abc123def456",
  cspSource: "vscode-webview://test-source",
  bundleUri: "vscode-resource://dist/webview/webview.bundle.js",
  mermaidLibraryUri: "vscode-resource://dist/webview/excalidraw/accordo-mermaid-shapes.excalidrawlib",
};

// ── WH-01..WH-06 ─────────────────────────────────────────────────────────────

describe("getWebviewHtml", () => {
  it("WH-01: output contains <!DOCTYPE html>", () => {
    expect(getWebviewHtml(OPTS)).toContain("<!DOCTYPE html>");
  });

  it("WH-02: CSP meta tag contains nonce-{nonce}", () => {
    expect(getWebviewHtml(OPTS)).toContain(`nonce-${OPTS.nonce}`);
  });

  it("WH-03: CSP meta tag contains cspSource", () => {
    expect(getWebviewHtml(OPTS)).toContain(OPTS.cspSource);
  });

  it("WH-04: contains <div id=\"excalidraw-root\">", () => {
    expect(getWebviewHtml(OPTS)).toContain('id="excalidraw-root"');
  });

  it("WH-05: <script> tag has nonce attribute and bundleUri src", () => {
    const html = getWebviewHtml(OPTS);
    expect(html).toContain(`nonce="${OPTS.nonce}"`);
    expect(html).toContain(`src="${OPTS.bundleUri}"`);
  });

  it("WH-06: style-src contains 'unsafe-inline'", () => {
    expect(getWebviewHtml(OPTS)).toContain("'unsafe-inline'");
  });

  it("WH-07: exposes the Mermaid library URI as a startup global when provided", () => {
    expect(getWebviewHtml(OPTS)).toContain(
      `window.__accordoMermaidLibraryUri = "${OPTS.mermaidLibraryUri}";`,
    );
  });
});

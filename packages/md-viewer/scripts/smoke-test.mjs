/**
 * Build-output smoke test — runs against dist/ to verify the compiled
 * extension produces correct HTML output from the renderer and all sub-modules
 * that are pure-Node and do NOT import the 'vscode' package.
 *
 * Modules tested here:   renderer, block-id-plugin, image-resolver,
 *                        webview-template, preview-bridge
 *
 * Modules excluded (import 'vscode', tested via vitest+mock):
 *                        commentable-preview, extension
 *
 * Run with:  node scripts/smoke-test.mjs   (from packages/md-viewer/)
 */

import { MarkdownRenderer } from "../dist/renderer.js";
import { blockIdPlugin, slugify } from "../dist/block-id-plugin.js";
import { ImageResolver } from "../dist/image-resolver.js";
import { buildWebviewHtml, themeKindToClass } from "../dist/webview-template.js";
import { PreviewBridge, toSdkThread } from "../dist/preview-bridge.js";
import MarkdownIt from "markdown-it";

let pass = 0;
let fail = 0;

function check(name, ok) {
  if (ok) {
    console.log("✅", name);
    pass++;
  } else {
    console.error("❌", name);
    fail++;
  }
}

// ── Renderer ─────────────────────────────────────────────────────────────────

console.log("\n── MarkdownRenderer ──");
const r = await MarkdownRenderer.create();

const rendererCases = [
  ["GFM table",       "| A | B |\n|---|---|\n| 1 | 2 |\n",      (h) => h.includes("<table")],
  ["Strikethrough",   "~~delete~~",                              (h) => /<s>|<del>/.test(h)],
  ["Task list",       "- [x] Done\n- [ ] Pending\n",            (h) => h.includes('type="checkbox"')],
  ["Shiki highlight", "```typescript\nconst x = 1;\n```\n",      (h) => /class="shiki/.test(h)],
  ["Inline math",     "Einstein: $E=mc^2$",                     (h) => h.includes("katex")],
  ["Display math",    "$$\\sum_{i=0}^{n} i$$",                  (h) => h.includes("katex-display")],
  ["Mermaid",         "```mermaid\ngraph TD\n  A-->B\n```\n",   (h) => h.includes('class="mermaid"')],
  ["Footnote",        "See[^1]\n\n[^1]: Footnote",              (h) => h.includes("footnote")],
  ["Emoji",           "Launch :rocket:",                         (h) => h.includes("🚀")],
  ["Front matter",    "---\ntitle: x\n---\n# H",                (h) => !h.includes("title: x") && h.includes("<h1")],
  ["Heading id",      "# Getting Started\n",                    (h) => h.includes('id="getting-started"')],
  ["Admonition",      "::: note\nImportant\n:::\n",             (h) => /admonition.*note|note.*admonition/.test(h)],
  ["Block id",        "# Intro\n",                              (h) => h.includes('data-block-id="heading:1:intro"')],
  ["Script strip",    "<script>alert('xss')</script>",          (h) => !h.includes("alert('xss')")],
];

for (const [name, md, fn] of rendererCases) {
  const { html } = await r.render(md, { docFsPath: "/project/README.md" });
  check(name, fn(html));
}

// Image resolution
{
  const mockWebview = {
    asWebviewUri: (uri) => ({ fsPath: uri.fsPath, toString: () => `vscode-resource:${uri.fsPath}` }),
  };
  const { html } = await r.render("![alt](./image.png)", {
    docFsPath: "/project/README.md",
    webview: mockWebview,
  });
  check("Image resolved to vscode-resource", html.includes("vscode-resource:"));
}

// BlockId resolver
{
  const { resolver } = await r.render("# Introduction\n\nParagraph\n", { docFsPath: "/project/README.md" });
  check("resolver.blockIdToLine heading:1:introduction = 0", resolver.blockIdToLine("heading:1:introduction") === 0);
  check("resolver.blockIdToLine p:0 = 2", resolver.blockIdToLine("p:0") === 2);
  check("resolver.lineToBlockId(0) = heading:1:introduction", resolver.lineToBlockId(0) === "heading:1:introduction");
  check("resolver.lineToBlockId(999) = null", resolver.lineToBlockId(999) === null);
}

// ── BlockIdPlugin standalone ──────────────────────────────────────────────────

console.log("\n── BlockIdPlugin ──");
const md = new MarkdownIt();
md.use(blockIdPlugin);

check("h1 data-block-id", /data-block-id="heading:1:intro"/.test(md.render("# Intro\n")));
check("h2 data-block-id", /data-block-id="heading:2:getting-started"/.test(md.render("## Getting Started\n")));
check("p:0", /data-block-id="p:0"/.test(md.render("One\n")));
check("li:0:0 and li:0:1", (() => {
  const h = md.render("- first\n- second\n");
  return /data-block-id="li:0:0"/.test(h) && /data-block-id="li:0:1"/.test(h);
})());
check("pre:0", /data-block-id="pre:0"/.test(md.render("```ts\nconst x = 1;\n```\n")));
check("duplicate slug :2/:3", (() => {
  const h = md.render("# Intro\n\n# Intro\n\n# Intro\n");
  return /heading:1:intro:2/.test(h) && /heading:1:intro:3/.test(h);
})());
check("slugify", slugify("Getting Started (2026)") === "getting-started-2026");

// ── ImageResolver ─────────────────────────────────────────────────────────────

console.log("\n── ImageResolver ──");
{
  const webview = { asWebviewUri: (u) => ({ ...u, toString: () => "vscode-resource:" + u.fsPath }) };
  const fs = { existsSync: (p) => p.includes("image.png") };
  const ir = new ImageResolver({ docFsPath: "/project/README.md", webview, fs });

  check("http passthrough", ir.resolve("http://example.com/img.png") === "http://example.com/img.png");
  check("data URI passthrough", ir.resolve("data:image/png;base64,abc").startsWith("data:"));
  check("relative resolve", ir.resolve("./image.png").includes("vscode-resource:"));
  check("missing file passthrough", ir.resolve("./missing.png") === "./missing.png");
}

// ── WebviewTemplate ────────────────────────────────────────────────────────────

console.log("\n── WebviewTemplate ──");
{
  const opts = {
    nonce: "ABC123",
    body: "<p>Hello</p>",
    katexCssUri: "vscode-resource:/ext/katex.min.css",
    mermaidJsUri: "vscode-resource:/ext/mermaid.min.js",
    sdkJsUri: "vscode-resource:/ext/sdk.js",
    sdkCssUri: "vscode-resource:/ext/sdk.css",
    themeKind: 2,
  };
  const html = buildWebviewHtml(opts);
  check("starts with DOCTYPE", html.trimStart().toLowerCase().startsWith("<!doctype html>"));
  check("CSP contains nonce", html.includes("'nonce-ABC123'"));
  check("KaTeX CSS link", html.includes("katex.min.css"));
  check("Mermaid script+nonce", html.includes("mermaid.min.js") && html.includes('nonce="ABC123"'));
  check("SDK script+nonce", html.includes("sdk.js") && html.includes('nonce="ABC123"'));
  check("body HTML injected", html.includes("<p>Hello</p>"));
  check("theme class dark", html.includes("vscode-dark"));
  check("AccordoCommentSDK init", html.includes("AccordoCommentSDK"));
  check("themeKindToClass(1) = vscode-light", themeKindToClass(1) === "vscode-light");
  check("themeKindToClass(3) = vscode-high-contrast", themeKindToClass(3) === "vscode-high-contrast");
  check("themeKindToClass(4) = vscode-high-contrast-light", themeKindToClass(4) === "vscode-high-contrast-light");
}


// ── PreviewBridge ─────────────────────────────────────────────────────────────

console.log("\n── PreviewBridge ──");
{
  let onChangedCb = null;
  let lastPost = null;
  let msgCb = null;
  let createThreadArgs = null;

  const store = {
    onChanged: (cb) => { onChangedCb = cb; return { dispose: () => {} }; },
    getThreadsForUri: () => [],
    createThread: async (args) => { createThreadArgs = args; return {}; },
    reply: async () => {},
    resolve: async () => {},
    delete: async () => {},
  };
  const webview = {
    postMessage: (msg) => { lastPost = msg; },
    onDidReceiveMessage: (cb) => { msgCb = cb; return { dispose: () => {} }; },
  };

  const bridge = new PreviewBridge(store, webview, "file:///project/README.md");
  check("onChanged subscribed", onChangedCb !== null);
  check("webview listener registered", msgCb !== null);

  bridge.loadThreadsForUri();
  check("loadThreadsForUri posts comments:load", lastPost?.type === "comments:load");

  // comment:create message
  msgCb({ type: "comment:create", blockId: "p:0", body: "Looks good" });
  await new Promise((res) => setTimeout(res, 50));
  check("comment:create calls createThread with body", createThreadArgs?.body === "Looks good");

  // store change for same URI should re-push
  lastPost = null;
  onChangedCb("file:///project/README.md");
  await new Promise((res) => setTimeout(res, 20));
  check("onChanged (same URI) triggers load", lastPost?.type === "comments:load");

  // store change for different URI — no push
  lastPost = null;
  onChangedCb("file:///other/file.md");
  await new Promise((res) => setTimeout(res, 20));
  check("onChanged (different URI) no push", lastPost === null);

  bridge.dispose();
  check("dispose completes without error", true);

  // toSdkThread
  const thread = {
    id: "t1",
    anchor: {
      kind: "surface",
      uri: "file:///project/README.md",
      surfaceType: "markdown-preview",
      coordinates: { type: "block", blockId: "heading:1:intro", blockType: "heading" },
    },
    comments: [],
    status: "open",
    createdAt: "2026-03-01T10:00:00Z",
    lastActivity: "2026-03-01T12:00:00Z",
  };
  const sdk = toSdkThread(thread, "2026-03-01T11:00:00Z");
  check("toSdkThread id", sdk.id === "t1");
  check("toSdkThread blockId", sdk.blockId === "heading:1:intro");
  check("toSdkThread hasUnread (lastActivity > loadedAt)", sdk.hasUnread === true);
  check("toSdkThread status open", sdk.status === "open");
}

// ── Summary ────────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(40)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

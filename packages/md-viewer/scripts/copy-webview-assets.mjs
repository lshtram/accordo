#!/usr/bin/env node
/**
 * Copies third-party webview assets into dist/ so the extension can serve
 * them via vscode-resource: URIs.
 *
 * Also wraps @accordo/comment-sdk as a browser IIFE (sdk.browser.js) so
 * it can be loaded with a plain <script> tag (no type="module" needed).
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(__dir, "..");
const dist = join(pkgDir, "dist");
const nm = join(pkgDir, "node_modules");

mkdirSync(dist, { recursive: true });

// ── 1. Comment SDK — wrap ESM class as browser IIFE ─────────────────────────
const sdkSrc = readFileSync(join(nm, "@accordo/comment-sdk/dist/sdk.js"), "utf8");
// Strip the `export ` prefix from `export class AccordoCommentSDK`
const stripped = sdkSrc.replace(/^export (class AccordoCommentSDK)/m, "$1");
const iife = `(function(){\n${stripped}\nwindow.AccordoCommentSDK = AccordoCommentSDK;\n})();\n`;
writeFileSync(join(dist, "sdk.browser.js"), iife, "utf8");
console.log("  ✓ sdk.browser.js");

// ── 2. Comment SDK CSS ───────────────────────────────────────────────────────
copyFileSync(
  join(nm, "@accordo/comment-sdk/src/sdk.css"),
  join(dist, "sdk.css"),
);
console.log("  ✓ sdk.css");

// ── 3. KaTeX CSS ─────────────────────────────────────────────────────────────
copyFileSync(
  join(nm, "katex/dist/katex.min.css"),
  join(dist, "katex.min.css"),
);
console.log("  ✓ katex.min.css");

// ── 4. KaTeX fonts ───────────────────────────────────────────────────────────
const fontsDir = join(dist, "fonts");
mkdirSync(fontsDir, { recursive: true });
const fontFiles = readdirSync(join(nm, "katex/dist/fonts"));
for (const f of fontFiles) {
  copyFileSync(join(nm, "katex/dist/fonts", f), join(fontsDir, f));
}
console.log(`  ✓ katex/fonts (${fontFiles.length} files)`);

// ── 5. Mermaid ───────────────────────────────────────────────────────────────
copyFileSync(
  join(nm, "mermaid/dist/mermaid.min.js"),
  join(dist, "mermaid.min.js"),
);
console.log("  ✓ mermaid.min.js");

// ── 6. Markdown body CSS ─────────────────────────────────────────────────────
copyFileSync(
  join(pkgDir, "src/markdown-body.css"),
  join(dist, "markdown-body.css"),
);
console.log("  ✓ markdown-body.css");

console.log("copy-webview-assets: done.");

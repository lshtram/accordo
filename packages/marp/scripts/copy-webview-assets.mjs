#!/usr/bin/env node
/**
 * Copies third-party webview assets into dist/ so the extension can serve
 * them via panel.webview.asWebviewUri(...) URIs.
 *
 * Bundles @accordo/comment-sdk as a browser IIFE (sdk.browser.js) so
 * it can be loaded with a plain <script> tag (no type="module" needed).
 */

import { copyFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as esbuild from "esbuild";

const __dir = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(__dir, "..");
const dist = join(pkgDir, "dist");
const nm = join(pkgDir, "node_modules");

mkdirSync(dist, { recursive: true });

// ── 1. Comment SDK — bundle as browser IIFE via esbuild ──────────────────────
// globalName "AccordoSDK" avoids a collision: the SDK module has a named export
// called "AccordoCommentSDK", so if globalName were also "AccordoCommentSDK",
// esbuild would assign the namespace object { AccordoCommentSDK: class } to the
// same-named global — making `new AccordoCommentSDK()` fail at runtime.
// The webview init script accesses the class as AccordoSDK.AccordoCommentSDK.
await esbuild.build({
  entryPoints: [join(nm, "@accordo/comment-sdk/dist/sdk.js")],
  bundle: true,
  format: "iife",
  globalName: "AccordoSDK",
  outfile: join(dist, "sdk.browser.js"),
  minify: false,
  sourcemap: false,
});
console.log("  ✓ sdk.browser.js (esbuild IIFE bundle)");

// ── 2. Comment SDK CSS ───────────────────────────────────────────────────────
copyFileSync(
  join(nm, "@accordo/comment-sdk/src/sdk.css"),
  join(dist, "sdk.css"),
);
console.log("  ✓ sdk.css");

console.log("copy-webview-assets: done.");

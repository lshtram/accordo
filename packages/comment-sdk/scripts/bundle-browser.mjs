#!/usr/bin/env node
/**
 * Wraps dist/sdk.js (ESM) into dist/sdk.browser.js (IIFE global).
 *
 * The SDK has no runtime imports (all `import type` → erased by tsc), so a
 * simple string transformation is sufficient:
 *   export class AccordoCommentSDK { … }
 * becomes:
 *   (function(){ class AccordoCommentSDK { … } window.AccordoCommentSDK = AccordoCommentSDK; })();
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dir, "../dist");

const src = readFileSync(join(distDir, "sdk.js"), "utf8");

// Strip `export ` prefix from the class declaration
const stripped = src.replace(/^export (class AccordoCommentSDK)/m, "$1");

// Wrap as IIFE that assigns to window
const iife = `(function(){\n${stripped}\nwindow.AccordoCommentSDK = AccordoCommentSDK;\n})();\n`;

writeFileSync(join(distDir, "sdk.browser.js"), iife, "utf8");
console.log("sdk.browser.js written.");

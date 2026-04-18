/**
 * M80-MANIFEST — Build Script
 *
 * esbuild configuration for the Accordo browser extension.
 * Produces 4 JS entry points + copies manifest.json, CSS, and popup.html.
 *
 * Entry points:
 *   dist/service-worker.js  — background service worker
 *   dist/content-script.js  — content script (comment-ui + message-handlers)
 *   dist/popup.js           — extension popup
 *   dist/shadow-tracker.js  — early closed-shadow tracker bootstrap
 *
 * Usage:
 *   npx tsx scripts/build.ts          # single build
 *   npx tsx scripts/build.ts --watch  # watch mode
 */

import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");
const SDK_SRC = path.resolve(ROOT, "..", "comment-sdk", "src");

const isWatch = process.argv.includes("--watch");

/** Ensure dist directory exists */
function ensureDist(): void {
  if (!fs.existsSync(DIST)) {
    fs.mkdirSync(DIST, { recursive: true });
  }
}

/** Copy a file from src to dist, logging the action */
function copyFile(srcPath: string, distFileName: string): void {
  const destPath = path.join(DIST, distFileName);
  fs.copyFileSync(srcPath, destPath);
  console.log(`  copied  ${distFileName}`);
}

/** Copy static assets (manifest.json, CSS, popup.html) */
function copyStaticAssets(): void {
  // manifest.json: src/manifest.json → dist/manifest.json
  copyFile(path.join(SRC, "manifest.json"), "manifest.json");

  // content-styles.css: merge SDK CSS + browser-extension content CSS into one file.
  // The SDK CSS provides .accordo-sdk-layer, .accordo-pin, .accordo-popover, etc.
  // The extension CSS provides .accordo-comment-form, .accordo-btn, light/dark themes.
  const sdkCss = fs.readFileSync(path.join(SDK_SRC, "sdk.css"), "utf-8");
  const extCss = fs.readFileSync(path.join(SRC, "content", "content-styles.css"), "utf-8");
  const merged = `/* === @accordo/comment-sdk styles === */\n${sdkCss}\n\n/* === browser-extension content styles === */\n${extCss}`;
  fs.writeFileSync(path.join(DIST, "content-styles.css"), merged);
  console.log(`  merged  content-styles.css (sdk.css + content-styles.css)`);

  // popup.html: src/popup/popup.html → dist/popup.html
  copyFile(path.join(SRC, "popup", "popup.html"), "popup.html");
}

/** Build timestamp injected as a global constant so the popup can display it */
const BUILD_TIME = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

/** esbuild shared options */
const sharedOptions: esbuild.BuildOptions = {
  bundle: true,
  platform: "browser",
  target: ["chrome120"],
  format: "esm",
  sourcemap: true,
  minify: false, // keep readable during development
  logLevel: "info",
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
};

/** Build all 3 entry points */
async function build(): Promise<void> {
  ensureDist();

  console.log("\nAccordo Browser Extension — Build");
  console.log("==================================");
  console.log(`  Root: ${ROOT}`);
  console.log(`  Src:  ${SRC}`);
  console.log(`  Dist: ${DIST}`);
  console.log(`  Mode: ${isWatch ? "watch" : "single build"}`);
  console.log("");

  // --- 1. Service Worker ---
  const swBuild = await esbuild.context({
    ...sharedOptions,
    entryPoints: [path.join(SRC, "service-worker.ts")],
    outfile: path.join(DIST, "service-worker.js"),
  });

  // --- 2. Content Script (combines content-pins + content-input + comment-sdk) ---
  // Content scripts in MV3 are injected as classic scripts, NOT ES modules.
  // format: "iife" wraps everything in an IIFE with no module boundary exports.
  // treeShaking is disabled so all functions are retained.
  //
  // The monorepoSdkPlugin resolves cross-package relative imports from content-entry.ts
  // (../../comment-sdk/src/*.js) to the absolute .ts source files in the monorepo,
  // so esbuild can bundle them without needing npm link or a workspace dependency.
  const monorepoSdkPlugin: esbuild.Plugin = {
    name: "monorepo-sdk",
    setup(build) {
      // Intercept any import that contains "comment-sdk/src/"
      build.onResolve({ filter: /comment-sdk\/src\// }, (args) => {
        const file = path.basename(args.path).replace(/\.js$/, ".ts");
        return { path: path.join(SDK_SRC, file) };
      });
    },
  };
  const contentBuild = await esbuild.context({
    ...sharedOptions,
    format: "iife",
    entryPoints: [path.join(SRC, "content", "content-entry.ts")],
    outfile: path.join(DIST, "content-script.js"),
    treeShaking: false,
    plugins: [monorepoSdkPlugin],
  });

  // --- 3. Early Shadow Tracker ---
  const shadowTrackerBuild = await esbuild.context({
    ...sharedOptions,
    format: "iife",
    entryPoints: [path.join(SRC, "content", "shadow-tracker-entry.ts")],
    outfile: path.join(DIST, "shadow-tracker.js"),
    treeShaking: false,
  });

  // --- 4. Popup ---
  const popupBuild = await esbuild.context({
    ...sharedOptions,
    entryPoints: [path.join(SRC, "popup.ts")],
    outfile: path.join(DIST, "popup.js"),
  });

  // Run all builds
  if (isWatch) {
    await Promise.all([swBuild.watch(), contentBuild.watch(), shadowTrackerBuild.watch(), popupBuild.watch()]);
    console.log("\nWatching for changes... (Ctrl+C to stop)\n");
  } else {
    await Promise.all([swBuild.rebuild(), contentBuild.rebuild(), shadowTrackerBuild.rebuild(), popupBuild.rebuild()]);
    await Promise.all([swBuild.dispose(), contentBuild.dispose(), shadowTrackerBuild.dispose(), popupBuild.dispose()]);

    // Copy static assets after JS build completes
    console.log("\nCopying static assets:");
    copyStaticAssets();

    console.log("\nBuild complete.\n");
    console.log("Output files:");
    const distFiles = fs.readdirSync(DIST).filter((f) => !f.startsWith("_"));
    for (const file of distFiles.sort()) {
      const stat = fs.statSync(path.join(DIST, file));
      const kb = (stat.size / 1024).toFixed(1);
      console.log(`  dist/${file} (${kb} KB)`);
    }
    console.log("");
  }
}

build().catch((err: unknown) => {
  console.error("Build failed:", err);
  process.exit(1);
});

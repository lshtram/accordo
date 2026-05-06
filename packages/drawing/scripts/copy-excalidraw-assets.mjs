#!/usr/bin/env node

import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const webviewDir = resolve(projectRoot, "dist/webview");

async function copyAssets() {
  await mkdir(resolve(webviewDir, "excalidraw-assets"), { recursive: true });
  await cp(
    resolve(projectRoot, "node_modules/@excalidraw/excalidraw/dist/excalidraw-assets"),
    resolve(webviewDir, "excalidraw-assets"),
    { recursive: true, force: true },
  );
  // Excalidraw's package runtime treats EXCALIDRAW_ASSET_PATH as a base
  // directory and appends /dist/excalidraw-assets/. Mirror that layout inside
  // the webview bundle so its internal async font loader resolves the same
  // local assets we preload explicitly.
  await mkdir(resolve(webviewDir, "dist/excalidraw-assets"), { recursive: true });
  await cp(
    resolve(projectRoot, "node_modules/@excalidraw/excalidraw/dist/excalidraw-assets"),
    resolve(webviewDir, "dist/excalidraw-assets"),
    { recursive: true, force: true },
  );
}

async function copyFonts() {
  await mkdir(webviewDir, { recursive: true });
  await cp(
    resolve(projectRoot, "node_modules/@excalidraw/excalidraw/dist/excalidraw-assets-dev/Virgil.woff2"),
    resolve(webviewDir, "Virgil.woff2"),
    { force: true },
  );
}

await Promise.all([copyAssets(), copyFonts()]);
console.log("drawing webview assets copied");

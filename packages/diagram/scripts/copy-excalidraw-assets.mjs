#!/usr/bin/env node

import { cp, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const srcDir = resolve(projectRoot, 'node_modules/@excalidraw/excalidraw/dist/excalidraw-assets');
const destDir = resolve(projectRoot, 'dist/webview/excalidraw-assets');
const srcLibraryDir = resolve(projectRoot, 'assets/excalidraw');
const destLibraryDir = resolve(projectRoot, 'dist/webview/excalidraw');

async function copyAssets() {
  try {
    await mkdir(destDir, { recursive: true });
    await cp(srcDir, destDir, { recursive: true, force: true });
    console.log('✓ excalidraw-assets copied successfully');
  } catch (error) {
    console.error('✗ Failed to copy excalidraw-assets:', error);
    process.exit(1);
  }
}

async function copyFonts() {
  try {
    const fontsDir = resolve(projectRoot, 'dist/webview');
    await mkdir(fontsDir, { recursive: true });
    const srcFont = resolve(projectRoot, 'node_modules/@excalidraw/excalidraw/dist/excalidraw-assets-dev/Virgil.woff2');
    const destFont = resolve(fontsDir, 'Virgil.woff2');
    await cp(srcFont, destFont, { force: true });
    console.log('✓ Virgil.woff2 copied successfully');
  } catch (error) {
    console.error('✗ Failed to copy fonts:', error);
    process.exit(1);
  }
}

async function copySdkCss() {
  try {
    const webviewDir = resolve(projectRoot, 'dist/webview');
    await mkdir(webviewDir, { recursive: true });
    const srcCss = resolve(projectRoot, 'node_modules/@accordo/comment-sdk/src/sdk.css');
    await cp(srcCss, resolve(webviewDir, 'sdk.css'), { force: true });
    console.log('\u2713 sdk.css copied successfully');
  } catch (error) {
    console.error('\u2717 Failed to copy sdk.css:', error);
    process.exit(1);
  }
}

async function copyMermaidLibrary() {
  try {
    await mkdir(destLibraryDir, { recursive: true });
    await cp(srcLibraryDir, destLibraryDir, { recursive: true, force: true });
    console.log('\u2713 Mermaid library copied successfully');
  } catch (error) {
    console.error('\u2717 Failed to copy Mermaid library:', error);
    process.exit(1);
  }
}

Promise.all([copyAssets(), copyFonts(), copySdkCss(), copyMermaidLibrary()]).catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});

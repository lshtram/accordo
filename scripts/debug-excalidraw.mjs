#!/usr/bin/env node
/**
 * Debug: generate Excalidraw JSON from a .mmd Mermaid file.
 * Writes to .accordo/diagrams/debug/<name>.excalidraw.json
 * 
 * Usage: node scripts/debug-excalidraw.mjs <diagram-name>
 *   e.g.: node scripts/debug-excalidraw.mjs class-demo
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(__dirname, "..");

// We need to initialize mermaid before importing the parser
// Since mermaid requires a DOM, we need jsdom or similar for Node.js
// For now, we'll just write the raw JSON structure

const name = process.argv[2] ?? "class-demo";
const mmdPath = resolve(workspaceRoot, "demo", `${name}.mmd`);
const outDir = resolve(workspaceRoot, ".accordo/diagrams", "debug");

if (!existsSync(mmdPath)) {
  console.error(`File not found: ${mmdPath}`);
  process.exit(1);
}

const source = readFileSync(mmdPath, "utf-8").trim();
console.log(`\n=== ${name}.mmd ===`);
console.log(source);
console.log();

// This script needs DOM for mermaid. 
// For quick debugging, let's at least show the file was read correctly.
mkdirSync(outDir, { recursive: true });

// Output the source for verification
console.log("Source file read successfully.");
console.log(`MMD path: ${mmdPath}`);
console.log(`Output dir: ${outDir}`);

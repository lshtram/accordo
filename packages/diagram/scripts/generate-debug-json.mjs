/**
 * B-DEBUG — Generate Excalidraw JSON for a demo diagram.
 * 
 * Run: pnpm --filter accordo-diagram exec node scripts/generate-debug-json.mjs <name>
 * 
 * This script uses the test infrastructure to avoid needing a DOM for mermaid.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "../..");

// For actual execution, we need DOM. 
// This is a placeholder - the actual generation happens in the test below.

console.log("Use: pnpm --filter accordo-diagram exec node scripts/generate-debug-json.mjs <name>");
console.log("Example: pnpm --filter accordo-diagram exec node scripts/generate-debug-json.mjs class-demo");

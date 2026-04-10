/**
 * Standalone debug script to generate Excalidraw JSON from a .mmd file.
 * Uses the VS Code extension's infrastructure via the panel commands.
 * 
 * Usage: node packages/diagram/scripts/debug-diagram.mjs <name>
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, "..");
const rootDir = resolve(__dirname, "../../..");
const demoDir = resolve(rootDir, "demo");
const outDir = resolve(rootDir, ".accordo/diagrams/debug");

const name = process.argv[2] ?? "class-demo";
const mmdPath = resolve(demoDir, `${name}.mmd`);

console.log(`\n=== Debug: ${name} ===`);
console.log(`MMD: ${mmdPath}`);
console.log(`OUT: ${outDir}`);

mkdirSync(outDir, { recursive: true });

const source = readFileSync(mmdPath, "utf-8").trim();
console.log(`\n--- ${name}.mmd ---`);
console.log(source);

// Now we need to parse with REAL mermaid and generate the canvas.
// The panel does this. Let's check what happens when we import the dist files.

// The dist files use ESM imports. Let's try to import the adapter.
try {
  // This will only work if mermaid can be loaded in Node.js
  const { parseMermaid } = await import(`${pkgDir}/dist/parser/adapter.js`);
  const { computeInitialLayout } = await import(`${pkgDir}/dist/layout/auto-layout.js`);
  const { generateCanvas } = await import(`${pkgDir}/dist/canvas/canvas-generator.js`);
  
  console.log("\n--- Parsing with real mermaid ---");
  const parseResult = await parseMermaid(source);
  
  if (!parseResult.valid) {
    console.error("PARSE ERROR:", parseResult.error);
    process.exit(1);
  }
  
  const { diagram: parsed } = parseResult;
  
  console.log("\nNodes:", [...parsed.nodes.keys()]);
  console.log("Edges:", parsed.edges.map(e => `${e.from} → ${e.to} [${e.type}] "${e.label || ""}"`));
  
  const layout = computeInitialLayout(parsed);
  
  console.log("\nNode positions:");
  for (const [id, nl] of Object.entries(layout.nodes)) {
    console.log(`  ${id}: (${nl.x}, ${nl.y}) ${nl.w}x${nl.h}`);
  }
  
  const { elements } = generateCanvas(parsed, layout);
  
  // Build Excalidraw scene
  const scene = {
    type: "excalidraw",
    version: 2,
    source: mmdPath,
    elements: elements.map(el => ({
      id: el.id,
      type: el.type,
      x: el.x,
      y: el.y,
      width: el.width ?? 0,
      height: el.height ?? 0,
      strokeColor: el.strokeColor ?? "#000",
      backgroundColor: el.backgroundColor ?? "#fff",
      strokeWidth: el.strokeWidth ?? 1,
      roughness: el.roughness ?? 1,
      opacity: el.opacity ?? 100,
      points: el.points ?? null,
      startBinding: el.startBinding ?? null,
      endBinding: el.endBinding ?? null,
      endArrowhead: el.type === "arrow" ? "arrow" : null,
      text: el.label ?? null,
      fontFamily: el.fontFamily ?? "Excalifont",
      fontSize: el.fontSize ?? 16,
      mermaidId: el.mermaidId,
      kind: el.kind,
    })),
    stats: {
      nodes: Object.keys(layout.nodes).length,
      edges: parsed.edges.length,
      elements: elements.length,
    }
  };
  
  const outPath = resolve(outDir, `${name}.excalidraw.json`);
  writeFileSync(outPath, JSON.stringify(scene, null, 2));
  console.log(`\nWritten: ${outPath}`);
  console.log(`Total elements: ${elements.length}`);
  
} catch (err) {
  console.error("\nError:", err.message);
  if (err.message?.includes("window") || err.message?.includes("document")) {
    console.log("\nNOTE: Mermaid requires a DOM. Use VS Code extension to generate actual output.");
  }
  console.log("\nUsing mock data instead for verification...");
  
  // Output what we expect
  console.log("\nExpected edges from class-demo.mmd:");
  console.log("  Animal <|-- Dog : inherits");
  console.log("  Animal <|-- Cat : inherits");
  console.log("  Dog o-- Cat : neighbors");
  console.log("  Zoo *-- Animal : contains");
}

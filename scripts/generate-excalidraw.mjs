/**
 * generate-excalidraw.mjs
 * Generates Excalidraw JSON for all flowchart diagrams.
 * 
 * Usage: node scripts/generate-excalidraw.mjs
 */

import { parseMermaid } from '../packages/diagram/dist/parser/adapter.js';
import { generateCanvas } from '../packages/diagram/dist/canvas/canvas-generator.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const MMD_DIR = join(ROOT, 'demo/flowchart');
const OUT_DIR = join(ROOT, '.tmp/visual-compare/excalidraw');
const PNG_DIR = join(ROOT, '.tmp/visual-compare/png-out');

// Ensure output directories exist
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(PNG_DIR, { recursive: true });

async function generateExcalidraw(num) {
  const mmdPath = join(MMD_DIR, `flowchart-${num}.mmd`);
  const jsonPath = join(OUT_DIR, `flowchart-${num}.json`);
  
  if (!existsSync(mmdPath)) {
    console.log(`  flowchart-${num}: .mmd not found, skipping`);
    return false;
  }
  
  // Skip if already exists
  if (existsSync(jsonPath)) {
    console.log(`  flowchart-${num}: already exists, skipping`);
    return true;
  }
  
  try {
    const mermaidSource = readFileSync(mmdPath, 'utf8');
    
    // Parse the Mermaid diagram
    const parseResult = await parseMermaid(mermaidSource);
    
    if (parseResult.errors && parseResult.errors.length > 0) {
      console.log(`  flowchart-${num}: parse errors:`, parseResult.errors);
      return false;
    }
    
    const parsed = parseResult.diagram;
    
    // Create a minimal layout store (positions will be computed by dagre)
    const layout = {
      version: '1.0',
      diagram_type: parsed.type,
      nodes: {},
      edges: {},
      clusters: {},
      unplaced: Array.from(parsed.nodes.keys()),
      aesthetics: {},
    };
    
    // Generate the canvas
    const canvas = generateCanvas(parsed, layout);
    
    // Write the Excalidraw JSON
    const excalidrawJson = {
      type: 'excalidraw',
      version: 2,
      source: mmdPath,
      mermaidSource: mermaidSource,
      elements: canvas.elements,
      appState: {
        viewBackgroundColor: '#ffffff',
      },
      files: {},
    };
    
    writeFileSync(jsonPath, JSON.stringify(excalidrawJson, null, 2), 'utf8');
    console.log(`  flowchart-${num}: ✓ JSON generated`);
    return true;
  } catch (err) {
    console.log(`  flowchart-${num}: ✗ ${err.message}`);
    return false;
  }
}

async function main() {
  console.log('Generating Excalidraw JSONs for all 51 flowcharts...\n');
  
  let success = 0;
  let failed = 0;
  
  for (let i = 0; i <= 50; i++) {
    const num = i.toString().padStart(2, '0');
    const result = await generateExcalidraw(num);
    if (result) success++;
    else failed++;
  }
  
  console.log(`\nDone: ${success} generated, ${failed} failed.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
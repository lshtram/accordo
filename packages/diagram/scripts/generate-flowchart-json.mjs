#!/usr/bin/env node
/**
 * Generate Excalidraw JSON for flowchart cases 0-50.
 * Run from packages/diagram/ directory.
 */

import { parseMermaid } from '/data/projects/accordo/packages/diagram/dist/parser/adapter.js';
import { computeInitialLayout } from '/data/projects/accordo/packages/diagram/dist/layout/auto-layout.js';
import { generateCanvas } from '/data/projects/accordo/packages/diagram/dist/canvas/canvas-generator.js';
import { toExcalidrawPayload } from '/data/projects/accordo/packages/diagram/dist/webview/scene-adapter.js';
import fs from 'fs';
import path from 'path';

const DEMO_DIR = '/data/projects/accordo/demo/flowchart';
const OUT_DIR = '/data/projects/accordo/.tmp/visual-compare/out';

fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];

for (let i = 0; i <= 50; i++) {
  const caseStr = String(i).padStart(2, '0');
  const mmdFile = path.join(DEMO_DIR, `flowchart-${caseStr}.mmd`);
  const outFile = path.join(OUT_DIR, `flowchart-${caseStr}-ours.json`);
  
  try {
    const mmd = fs.readFileSync(mmdFile, 'utf8');
    const parsed = await parseMermaid(mmd);
    const layout = computeInitialLayout(parsed.diagram);
    const canvas = generateCanvas(parsed.diagram, layout);
    const payload = toExcalidrawPayload(canvas.elements);
    
    const out = {
      type: 'excalidraw',
      version: 2,
      source: `flowchart-${caseStr}.mmd`,
      elements: payload,
      appState: { viewBackgroundColor: '#ffffff' },
      files: {}
    };
    
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
    
    const elementCount = payload.length;
    const elementTypes = [...new Set(payload.map(e => e.type))];
    
    results.push({
      case: i,
      status: 'success',
      elementCount,
      elementTypes,
      outputFile: outFile
    });
    
    console.log(`[${i}] ✓ success — ${elementCount} elements [${elementTypes.join(', ')}] → ${path.basename(outFile)}`);
  } catch (err) {
    results.push({
      case: i,
      status: 'error',
      error: err.message,
      outputFile: outFile
    });
    console.error(`[${i}] ✗ ERROR: ${err.message}`);
  }
}

// Summary
console.log('\n=== SUMMARY ===');
console.log(`Total: ${results.length}`);
console.log(`Success: ${results.filter(r => r.status === 'success').length}`);
console.log(`Failed: ${results.filter(r => r.status === 'error').length}`);

if (results[0] && results[0].status === 'success') {
  console.log('\n=== CASE 0 DETAILS ===');
  console.log(JSON.stringify(results[0], null, 2));
}

import { readFileSync } from 'fs';
import { join, dirname } from 'path';

const data = JSON.parse(readFileSync(join(dirname(__filename), 'state-results.json'), 'utf-8'));

function parseViewBox(svg: string): { width: number; height: number } | null {
  const match = svg.match(/viewBox="0 0 ([\d.]+)\s+([\d.]+)"/);
  if (match) return { width: parseFloat(match[1]), height: parseFloat(match[2]) };
  return null;
}

function countMermaidNodes(svg: string): number {
  // Mermaid uses foreignObject with <p> tags for text content
  const foRe = /<foreignObject[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/foreignObject>/gi;
  let count = 0;
  let m;
  while ((m = foRe.exec(svg)) !== null) {
    const content = m[1].replace(/<[^>]+>/g, '').trim();
    if (content.length > 0) count++;
  }
  return count;
}

function countMermaidEdges(svg: string): number {
  // Mermaid transitions are <path> elements with class containing "transition" and data-edge="true"
  const re = /<path[^>]*class="[^"]*transition[^"]*"[^>]*data-edge="true"[^>]*>/gi;
  return svg.match(re)?.length || 0;
}

function countAccordoNodes(svg: string): number {
  // Accordo uses <text> elements with content
  const re = /<text[^>]*>([\s\S]*?)<\/text>/gi;
  let count = 0;
  let m;
  while ((m = re.exec(svg)) !== null) {
    const content = m[1].replace(/<[^>]+>/g, '').trim();
    if (content.length > 0) count++;
  }
  return count;
}

function countAccordoEdges(svg: string): number {
  // Accordo arrows: <g transform="translate(...)"> with path (containing C for bezier) but no text
  const gRe = /<g[^>]*transform="translate\([^"]+\)"[^>]*>[\s\S]*?<\/g>/gi;
  const groups = svg.match(gRe) || [];
  let count = 0;
  for (const g of groups) {
    const hasText = /<text[^>]*>[^<]+<\/text>/i.test(g);
    const hasPath = /<path[^>]*d="[^"]*"[^>]*>/i.test(g) && /d="[^"]*C[^"]*"/.test(g);
    if (!hasText && hasPath) count++;
  }
  return count;
}

console.log('Case | Mermaid Nodes | Accordo Nodes | Mermaid Edges | Accordo Edges | ViewBox Ratio');
console.log('-----|----------------|---------------|--------------|---------------|-------------');

for (const result of data.results) {
  const mv = parseViewBox(result.svgMermaid);
  const av = parseViewBox(result.svgAccordo);
  const mNodes = countMermaidNodes(result.svgMermaid);
  const aNodes = countAccordoNodes(result.svgAccordo);
  const mEdges = countMermaidEdges(result.svgMermaid);
  const aEdges = countAccordoEdges(result.svgAccordo);
  
  let ratio = '';
  if (mv && av) {
    ratio = `${(av.width / mv.width).toFixed(2)}x / ${(av.height / mv.height).toFixed(2)}x`;
  }
  
  console.log(`${result.name.padEnd(22)} | ${String(mNodes).padStart(14)} | ${String(aNodes).padStart(13)} | ${String(mEdges).padStart(12)} | ${String(aEdges).padStart(13)} | ${ratio}`);
}

console.log('\n--- SIMPLE CASE DETAIL ---\n');
const simple = data.results[0];

const svM = parseViewBox(simple.svgMermaid);
const svA = parseViewBox(simple.svgAccordo);

console.log('Mermaid viewBox:', svM ? `${svM.width} x ${svM.height}` : 'not found');
console.log('Accordo viewBox:', svA ? `${svA.width} x ${svA.height}` : 'not found');

console.log('\nMermaid text nodes (foreignObject/p):');
const foRe = /<foreignObject[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>[\s\S]*?<\/foreignObject>/gi;
let m;
while ((m = foRe.exec(simple.svgMermaid)) !== null) {
  const content = m[1].replace(/<[^>]+>/g, '').trim();
  if (content.length > 0) console.log('  -', content);
}

console.log('\nMermaid transition edges (path with transition class + data-edge):');
const transPaths = simple.svgMermaid.match(/<path[^>]*class="[^"]*transition[^"]*"[^>]*data-edge="true"[^>]*>/gi) || [];
console.log('  Total transitions:', transPaths.length);
for (const p of transPaths) {
  const idMatch = p.match(/id="([^"]*)"/);
  const id = idMatch ? idMatch[1] : 'unknown';
  console.log('  - edge:', id);
}

console.log('\nAccordo text nodes:');
const accTextRe = /<text[^>]*>([\s\S]*?)<\/text>/gi;
let at;
while ((at = accTextRe.exec(simple.svgAccordo)) !== null) {
  const content = at[1].replace(/<[^>]+>/g, '').trim();
  if (content.length > 0) console.log('  -', content);
}

console.log('\nAccordo arrow paths (in translate groups, no text):');
const gRe = /<g[^>]*transform="translate\([^"]+\)"[^>]*>[\s\S]*?<\/g>/gi;
const groups = simple.svgAccordo.match(gRe) || [];
let arrowCount = 0;
for (const g of groups) {
  const hasText = /<text[^>]*>[^<]+<\/text>/i.test(g);
  const hasPath = /<path[^>]*d="[^"]*"[^>]*>/i.test(g) && /d="[^"]*C[^"]*"/.test(g);
  if (!hasText && hasPath) {
    arrowCount++;
    const transMatch = g.match(/transform="translate\(([^,]+),\s*([^\)]+)\)/);
    if (transMatch) {
      console.log(`  arrow at translate(${transMatch[1]}, ${transMatch[2]})`);
    }
  }
}
console.log('Total Accordo arrows:', arrowCount);

console.log('\n\n=== SIMPLE CASE VIEWBOX ANALYSIS ===');
console.log('Mermaid viewBox: width=', svM?.width, 'height=', svM?.height);
console.log('Accordo viewBox: width=', svA?.width, 'height=', svA?.height);
if (svM && svA) {
  console.log('Width ratio (Accordo/Mermaid):', (svA.width / svM.width).toFixed(4));
  console.log('Height ratio (Accordo/Mermaid):', (svA.height / svM.height).toFixed(4));
  console.log('Mermaid aspect ratio (w/h):', (svM.width / svM.height).toFixed(4));
  console.log('Accordo aspect ratio (w/h):', (svA.width / svA.height).toFixed(4));
}
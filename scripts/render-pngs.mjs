/**
 * render-pngs.mjs
 * Renders Excalidraw JSON files to PNG using Playwright + Excalidraw CDN.
 * 
 * Usage: node scripts/render-pngs.mjs
 */

import { chromium } from '/home/liorshtram/.nvm/versions/node/v24.14.0/lib/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const EXC_DIR = join(ROOT, '.tmp/visual-compare/excalidraw');
const PNG_DIR = join(ROOT, '.tmp/visual-compare/png-out');
const PORT = 18737;

// Ensure output directory exists
mkdirSync(PNG_DIR, { recursive: true });

// HTTP server to serve the Excalidraw JSON files
function startServer() {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      let urlPath = req.url.split('?')[0];
      const filePath = join(EXC_DIR, urlPath);
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const data = readFileSync(filePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    srv.listen(PORT, 'localhost', () => resolve(srv));
  });
}

function makeHTML(name, sceneData) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#fff;overflow:hidden}
#root{width:100vw;height:100vh}
</style></head>
<body><div id="root"></div>
<script type="module">
import * as Excalidraw from 'https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@0.17.6/+esm';
const sceneData = ${JSON.stringify(sceneData)};
const app = await Excalidraw.initializeExcalidraw({ 
  initHTML: document.getElementById('root'), 
  excalidrawRef: { current: null } 
});
await app.importScene(sceneData);
window.__READY__ = true;
</script></body>
</html>`;
}

async function renderPng(name, browser) {
  const jsonPath = join(EXC_DIR, `${name}.json`);
  const pngPath = join(PNG_DIR, `${name}.png`);
  
  if (!existsSync(jsonPath)) {
    console.log(`  ${name}: JSON not found, skipping`);
    return 'skip';
  }
  
  if (existsSync(pngPath)) {
    console.log(`  ${name}: PNG already exists, skipping`);
    return 'skip';
  }
  
  const scene = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const html = makeHTML(name, scene);
  const htmlPath = join(PNG_DIR, `${name}.render.html`);
  writeFileSync(htmlPath, html, 'utf8');
  
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  try {
    await page.goto(`http://localhost:${PORT}/${name}.render.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => window.__READY__ === true, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(300);
    
    const canvas = await page.$('canvas');
    const buf = await (canvas ?? page).screenshot({ type: 'png' });
    writeFileSync(pngPath, buf);
    console.log(`  ${name}: ✓ PNG rendered`);
    return 'ok';
  } catch (err) {
    console.log(`  ${name}: ✗ ${err.message.slice(0, 60)}`);
    return 'fail';
  } finally {
    await page.close();
  }
}

async function main() {
  const srv = await startServer();
  console.log(`Server on :${PORT}\n`);
  
  const browser = await chromium.launch({ headless: true });
  
  // Get all flowchart names
  const names = [];
  for (let i = 0; i <= 50; i++) {
    names.push(`flowchart-${i.toString().padStart(2, '0')}`);
  }
  // Also add state diagrams and class-demo
  names.push('state-basic', 'state-choice', 'state-composite', 'state-concurrency', 'state-nested', 'class-demo');
  
  let ok = 0, fail = 0, skip = 0;
  
  for (const name of names) {
    const result = await renderPng(name, browser);
    if (result === 'ok') ok++;
    else if (result === 'fail') fail++;
    else skip++;
  }
  
  await browser.close();
  srv.close();
  
  console.log(`\nDone: ${ok} rendered, ${fail} failed, ${skip} skipped.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
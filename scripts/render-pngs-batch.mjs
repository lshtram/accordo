/**
 * render-pngs-batch.mjs
 * Renders Excalidraw JSON files to PNG using Playwright.
 * Creates a fresh browser for each diagram to avoid crashes.
 * 
 * Usage: node scripts/render-pngs-batch.mjs [start] [end]
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
const PORT = 18738;

mkdirSync(PNG_DIR, { recursive: true });

let server;
function startServer() {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
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
    server.listen(PORT, 'localhost', () => resolve());
  });
}

function makeHTML(sceneData) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
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
</script></body></html>`;
}

async function renderPng(name) {
  const jsonPath = join(EXC_DIR, `${name}.json`);
  const pngPath = join(PNG_DIR, `${name}.png`);
  
  if (!existsSync(jsonPath)) return 'skip';
  if (existsSync(pngPath)) return 'skip';
  
  const scene = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const html = makeHTML(scene);
  const htmlPath = join(PNG_DIR, `${name}.render.html`);
  writeFileSync(htmlPath, html, 'utf8');
  
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    
    await page.goto(`http://localhost:${PORT}/${name}.render.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.waitForFunction(() => window.__READY__ === true, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(200);
    
    const canvas = await page.$('canvas');
    const buf = await (canvas ?? page).screenshot({ type: 'png' });
    writeFileSync(pngPath, buf);
    return 'ok';
  } catch (err) {
    return 'fail:' + err.message.slice(0, 50);
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function main() {
  await startServer();
  console.log(`Server on :${PORT}\n`);
  
  const start = parseInt(process.argv[2] ?? '0');
  const end = parseInt(process.argv[3] ?? '50');
  
  let ok = 0, fail = 0, skip = 0;
  
  for (let i = start; i <= end; i++) {
    const name = `flowchart-${i.toString().padStart(2, '0')}`;
    process.stdout.write(`  ${name}... `);
    const result = await renderPng(name);
    if (result === 'ok') { console.log('✓'); ok++; }
    else if (result === 'skip') { console.log('skip'); skip++; }
    else { console.log('✗', result); fail++; }
  }
  
  server.close();
  console.log(`\nDone: ${ok} rendered, ${fail} failed, ${skip} skipped.`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
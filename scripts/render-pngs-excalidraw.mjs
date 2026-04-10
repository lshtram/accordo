/**
 * render-pngs-excalidraw.mjs
 * Renders Excalidraw JSON files to PNG using the local Excalidraw bundle.
 * Uses exportToBlob for proper rendering.
 */

import { chromium } from '/home/liorshtram/.nvm/versions/node/v24.14.0/lib/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const EXC_DIR = join(ROOT, '.tmp/visual-compare/excalidraw');
const PNG_DIR = join(ROOT, '.tmp/visual-compare/png-out');
const EXC_LIB = join(ROOT, 'packages/diagram/node_modules/@excalidraw/excalidraw/dist');
const PORT = 18743;

mkdirSync(PNG_DIR, { recursive: true });

const jsonFiles = readdirSync(EXC_DIR).filter(f => f.endsWith('.json'));
console.log(`Found ${jsonFiles.length} Excalidraw JSONs\n`);

let server;
function startServer() {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      let urlPath = req.url.split('?')[0];
      
      // Serve Excalidraw library files
      if (urlPath.startsWith('/lib/')) {
        const libPath = join(EXC_LIB, urlPath.replace('/lib/', ''));
        if (existsSync(libPath)) {
          const data = readFileSync(libPath);
          const ext = libPath.endsWith('.js') ? 'application/javascript' : 
                      libPath.endsWith('.css') ? 'text/css' : 
                      'application/octet-stream';
          res.writeHead(200, { 'Content-Type': ext });
          res.end(data);
          return;
        }
      }
      
      // Serve JSON files
      if (urlPath.endsWith('.json')) {
        const filePath = join(EXC_DIR, urlPath);
        if (existsSync(filePath)) {
          const data = readFileSync(filePath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(data);
          return;
        }
      }
      
      // Serve HTML files
      if (urlPath.endsWith('.html')) {
        const filePath = join(PNG_DIR, urlPath);
        if (existsSync(filePath)) {
          const data = readFileSync(filePath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(data);
          return;
        }
      }
      
      res.writeHead(404);
      res.end('Not found');
    });
    server.listen(PORT, 'localhost', () => resolve());
  });
}

function makeHTML(sceneData, name) {
  const elements = sceneData.elements || [];
  
  // Calculate bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    if (typeof el.x === 'number' && typeof el.y === 'number') {
      if (el.x < minX) minX = el.x;
      if (el.y < minY) minY = el.y;
      if (el.x + (el.width || 0) > maxX) maxX = el.x + (el.width || 0);
      if (el.y + (el.height || 0) > maxY) maxY = el.y + (el.height || 0);
    }
  }
  
  const padding = 50;
  const width = Math.max(maxX - minX + padding * 2, 400);
  const height = Math.max(maxY - minY + padding * 2, 300);
  const offsetX = -minX + padding;
  const offsetY = -minY + padding;
  
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#fff}
</style>
</head>
<body>
<script src="/lib/excalidraw-with-preact.production.min.js"></script>
<script>
const elements = ${JSON.stringify(elements)};
const offsetX = ${offsetX};
const offsetY = ${offsetY};
const width = ${width};
const height = ${height};

// Adjust element positions to center them
const adjustedElements = elements.map(el => ({
  ...el,
  x: (el.x || 0) + offsetX,
  y: (el.y || 0) + offsetY,
}));

// Wait for ExcalidrawLib to be available
function waitForExcalidraw() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      if (window.ExcalidrawLib && window.ExcalidrawLib.exportToBlob) {
        resolve();
      } else if (attempts > 50) {
        reject(new Error('ExcalidrawLib not available'));
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

waitForExcalidraw()
  .then(async () => {
    const { exportToBlob } = window.ExcalidrawLib;
    
    const blob = await exportToBlob({
      elements: adjustedElements,
      files: null,
      mimeType: 'image/png',
      appState: {
        exportBackground: true,
        viewBackgroundColor: '#ffffff',
        width: width,
        height: height,
      }
    });
    
    const reader = new FileReader();
    reader.onload = () => {
      window.__PNG__ = reader.result;
      window.__READY__ = true;
    };
    reader.onerror = (err) => {
      window.__ERROR__ = 'FileReader error: ' + err;
    };
    reader.readAsDataURL(blob);
  })
  .catch(err => {
    window.__ERROR__ = err.message || String(err);
  });
</script>
</body>
</html>`;
}

async function renderPng(name) {
  const jsonPath = join(EXC_DIR, `${name}.json`);
  const pngPath = join(PNG_DIR, `${name}.png`);
  
  if (!existsSync(jsonPath)) return 'skip';
  
  const scene = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const html = makeHTML(scene, name);
  const htmlPath = join(PNG_DIR, `${name}.render.html`);
  writeFileSync(htmlPath, html, 'utf8');
  
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    await page.goto(`http://localhost:${PORT}/${name}.render.html`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });
    
    // Wait for export to complete
    await page.waitForFunction(() => window.__READY__ || window.__ERROR__, { timeout: 30000 });
    
    const error = await page.evaluate(() => window.__ERROR__);
    if (error) {
      return 'fail: ' + error;
    }
    
    const dataUrl = await page.evaluate(() => window.__PNG__);
    if (!dataUrl) {
      return 'fail: no PNG data';
    }
    
    const base64 = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    writeFileSync(pngPath, buffer);
    
    return 'ok';
  } catch (err) {
    return 'fail: ' + err.message.slice(0, 80);
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function main() {
  await startServer();
  console.log(`Server on :${PORT}\n`);
  
  let ok = 0, fail = 0, skip = 0;
  
  for (const file of jsonFiles) {
    const name = file.replace('.json', '');
    process.stdout.write(`  ${name}... `);
    
    const result = await renderPng(name);
    
    if (result === 'ok') { 
      console.log('✓'); 
      ok++; 
    } else if (result === 'skip') { 
      console.log('skip'); 
      skip++; 
    } else { 
      console.log('✗', result); 
      fail++; 
    }
  }
  
  server.close();
  console.log(`\nDone: ${ok} rendered, ${fail} failed, ${skip} skipped.`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  server?.close();
  process.exit(1);
});
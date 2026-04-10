/**
 * render-pngs-simple.mjs
 * Renders Excalidraw JSON files to PNG by taking a screenshot of the rendered canvas.
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
const PORT = 18742;

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
      if (urlPath.startsWith('/excalidraw/')) {
        const libPath = join(EXC_LIB, urlPath.replace('/excalidraw/', ''));
        if (existsSync(libPath)) {
          const data = readFileSync(libPath);
          const ext = urlPath.endsWith('.js') ? '.js' : urlPath.endsWith('.css') ? '.css' : '';
          const contentType = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
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
  
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#fff;display:flex;justify-content:center;align-items:center;min-height:100vh}
#canvas{background:#fff}
</style>
</head>
<body>
<canvas id="canvas" width="${width}" height="${height}"></canvas>
<script>
const elements = ${JSON.stringify(elements)};
const offsetX = ${-minX + padding};
const offsetY = ${-minY + padding};

// Adjust element positions
const adjustedElements = elements.map(el => ({
  ...el,
  x: (el.x || 0) + offsetX,
  y: (el.y || 0) + offsetY,
}));

// Simple canvas renderer for Excalidraw elements
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#ffffff';
ctx.fillRect(0, 0, canvas.width, canvas.height);

// Draw each element
for (const el of adjustedElements) {
  if (el.type === 'rectangle' || el.type === 'ellipse') {
    ctx.strokeStyle = el.strokeColor || '#1e1e1e';
    ctx.lineWidth = el.strokeWidth || 1;
    ctx.fillStyle = el.backgroundColor === 'transparent' ? 'transparent' : (el.backgroundColor || '#ffffff');
    
    if (el.type === 'rectangle') {
      if (el.fillStyle === 'hachure') {
        // Sketchy fill
        ctx.fillRect(el.x, el.y, el.width, el.height);
        ctx.strokeRect(el.x, el.y, el.width, el.height);
        // Add hatching
        ctx.beginPath();
        for (let i = 0; i < el.width + el.height; i += 8) {
          ctx.moveTo(el.x + i, el.y);
          ctx.lineTo(el.x, el.y + i);
        }
        ctx.stroke();
      } else {
        ctx.fillRect(el.x, el.y, el.width, el.height);
        ctx.strokeRect(el.x, el.y, el.width, el.height);
      }
    } else {
      ctx.beginPath();
      ctx.ellipse(el.x + el.width/2, el.y + el.height/2, el.width/2, el.height/2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (el.type === 'text') {
    ctx.font = (el.fontSize || 14) + 'px sans-serif';
    ctx.fillStyle = el.strokeColor || '#1e1e1e';
    ctx.textAlign = el.textAlign || 'center';
    ctx.textBaseline = el.verticalAlign || 'middle';
    ctx.fillText(el.text || '', el.x + (el.width || 0)/2, el.y + (el.height || 0)/2);
  } else if (el.type === 'arrow' || el.type === 'line') {
    ctx.strokeStyle = el.strokeColor || '#1e1e1e';
    ctx.lineWidth = el.strokeWidth || 1;
    ctx.beginPath();
    if (el.points && el.points.length > 0) {
      ctx.moveTo(el.x + el.points[0][0], el.y + el.points[0][1]);
      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(el.x + el.points[i][0], el.y + el.points[i][1]);
      }
    }
    ctx.stroke();
    
    // Draw arrowhead
    if (el.type === 'arrow' && el.points && el.points.length >= 2) {
      const lastPoint = el.points[el.points.length - 1];
      const prevPoint = el.points[el.points.length - 2];
      const angle = Math.atan2(lastPoint[1] - prevPoint[1], lastPoint[0] - prevPoint[0]);
      const headLen = 10;
      ctx.beginPath();
      ctx.moveTo(el.x + lastPoint[0], el.y + lastPoint[1]);
      ctx.lineTo(el.x + lastPoint[0] - headLen * Math.cos(angle - Math.PI/6), el.y + lastPoint[1] - headLen * Math.sin(angle - Math.PI/6));
      ctx.moveTo(el.x + lastPoint[0], el.y + lastPoint[1]);
      ctx.lineTo(el.x + lastPoint[0] - headLen * Math.cos(angle + Math.PI/6), el.y + lastPoint[1] - headLen * Math.sin(angle + Math.PI/6));
      ctx.stroke();
    }
  }
}

window.__READY__ = true;
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
      timeout: 15000 
    });
    
    // Wait for rendering
    await page.waitForFunction(() => window.__READY__, { timeout: 5000 });
    
    // Take screenshot of canvas
    const canvas = await page.$('#canvas');
    const buffer = await canvas.screenshot({ type: 'png' });
    writeFileSync(pngPath, buffer);
    
    return 'ok';
  } catch (err) {
    return 'fail: ' + err.message.slice(0, 60);
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
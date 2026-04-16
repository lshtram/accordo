/**
 * render.ts
 * Renders each test case through all 3 paths to SVG strings.
 * Uses Playwright for browser-based rendering.
 *
 * Architecture: Single Playwright browser is reused for all paths.
 * Path A (Mermaid): Uses mermaid library loaded from local file via HTTP server.
 * Paths B/C (Excalidraw): Uses UMD bundle with React + ReactDOM dependencies.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { readFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

// ── Library paths ─────────────────────────────────────────────────────────────

const DIAGRAM_MODULES = join(ROOT, "packages/diagram/node_modules");

const MERMAID_LIB    = join(DIAGRAM_MODULES, "mermaid/dist/mermaid.min.js");
const REACT_UMD      = join(DIAGRAM_MODULES, "react/umd/react.production.min.js");
const REACT_DOM_UMD  = join(DIAGRAM_MODULES, "react-dom/umd/react-dom.production.min.js");
const EXCALIDRAW_UMD = join(DIAGRAM_MODULES, "@excalidraw/excalidraw/dist/excalidraw.production.min.js");
const MERMAID_TO_EXCALIDRAW_BUNDLE = join(
  __dirname,
  "dist/mermaid-to-excalidraw.iife.js"
);

// ── HTTP server for library serving ──────────────────────────────────────────

interface HttpServer { port: number; close: () => void }

let _server: HttpServer | null = null;

async function ensureServer(): Promise<number> {
  if (!_server) _server = await _startServer();
  return _server.port;
}

function _startServer(): Promise<HttpServer> {
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const urlPath = (req.url ?? "/").split("?")[0];

      const files: Record<string, string> = {
        "/mermaid.min.js":              MERMAID_LIB,
        "/react.production.min.js":      REACT_UMD,
        "/react-dom.production.min.js":  REACT_DOM_UMD,
        "/excalidraw.min.js":           EXCALIDRAW_UMD,
        "/mermaid-to-excalidraw.js":    MERMAID_TO_EXCALIDRAW_BUNDLE,
      };

      const target = files[urlPath];
      if (target && existsSync(target)) {
        res.writeHead(200, { "Content-Type": "application/javascript" });
        res.end(readFileSync(target, "utf-8"));
      } else {
        res.writeHead(404); res.end("Not found: " + urlPath);
      }
    });

    srv.listen(0, "localhost", () => {
      const addr = srv.address();
      const port = (addr && typeof addr === "object") ? addr.port : 18000;
      resolve({ port, close: () => srv.close() });
    });
  });
}

// ── Playwright singleton ──────────────────────────────────────────────────────

type BrowserInstance = Awaited<ReturnType<Awaited<ReturnType<typeof import("/home/liorshtram/.nvm/versions/node/v24.14.0/lib/node_modules/playwright/index.mjs")["chromium"]>["launch"]>>>;
type PlaywrightModule = typeof import("/home/liorshtram/.nvm/versions/node/v24.14.0/lib/node_modules/playwright/index.mjs");

let _browser: BrowserInstance | null = null;
let _playwright: PlaywrightModule | null = null;

async function ensureBrowser(): Promise<{ browser: BrowserInstance; pw: PlaywrightModule }> {
  const disconnected =
    _browser !== null &&
    "isConnected" in _browser &&
    typeof (_browser as { isConnected?: () => boolean }).isConnected === "function" &&
    !(_browser as { isConnected: () => boolean }).isConnected();

  if (!_playwright || !_browser || disconnected) {
    _playwright = await import("/home/liorshtram/.nvm/versions/node/v24.14.0/lib/node_modules/playwright/index.mjs");
    _browser = await _playwright.chromium.launch({ headless: true });
  }
  return { browser: _browser, pw: _playwright };
}

async function resetBrowser(): Promise<void> {
  if (_browser) {
    try {
      await _browser.close();
    } catch {
      // ignore
    }
  }
  _browser = null;
}

async function withClosedBrowserRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = String(err);
    const isClosed =
      msg.includes("has been closed") ||
      msg.includes("Target page, context or browser has been closed") ||
      msg.includes("Browser has been closed");
    if (!isClosed) throw err;
    await resetBrowser();
    return await fn();
  }
}

// ── Path A: Mermaid SVG via Playwright ────────────────────────────────────────

async function pathAMermaid(definition: string): Promise<string> {
  return withClosedBrowserRetry(async () => {
    const { browser } = await ensureBrowser();
    const port = await ensureServer();
    const page = await browser.newPage();

  const escapedDef = definition.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="http://localhost:${port}/mermaid.min.js"></script></head>
<body><div id="container"></div>
<script>
(async () => {
  try {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
    const { svg } = await mermaid.render('mermaid-svg', \`${escapedDef}\`, document.getElementById('container'));
    window.__SVG__ = svg;
  } catch (err) { window.__ERROR__ = err.message || String(err); }
  window.__READY__ = true;
})().catch(e => { window.__ERROR__ = e.message; window.__READY__ = true; });
</script></body></html>`;

    try {
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (window as Record<string, unknown>).__READY__, { timeout: 60000 });

      const err = await page.evaluate(() => (window as Record<string, unknown>).__ERROR__);
      if (err) throw new Error(String(err));

      return await page.evaluate(() => (window as Record<string, unknown>).__SVG__) as string;
    } finally {
      await page.close();
    }
  });
}

// ── Path B & C helper: render Excalidraw SVG via Playwright ───────────────────
// Uses the UMD bundle (excalidraw.production.min.js) which requires React + ReactDOM.
// The library is exposed as window.ExcalidrawLib with an exportToSvg method.

async function renderExcalidrawSvg(elements: unknown[]): Promise<string> {
  return withClosedBrowserRetry(async () => {
    const { browser } = await ensureBrowser();
    const port = await ensureServer();
    const page = await browser.newPage();

  // Serialize elements - plain JSON, no TypeScript
  const elementsJson = JSON.stringify(elements);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="http://localhost:${port}/react.production.min.js"></script>
<script src="http://localhost:${port}/react-dom.production.min.js"></script>
<script src="http://localhost:${port}/excalidraw.min.js"></script>
</head>
<body><div id="root"></div>
<script>
(async () => {
  try {
    // Wait for ExcalidrawLib to be available
    let attempts = 0;
    while (!window.ExcalidrawLib && attempts < 100) {
      await new Promise(r => setTimeout(r, 100)); attempts++;
    }
    console.log('[PAGE] ExcalidrawLib ready, attempts:', attempts);

    const exportFn = window.ExcalidrawLib && window.ExcalidrawLib.exportToSvg;
    if (!exportFn) {
      const keys = window.ExcalidrawLib ? Object.keys(window.ExcalidrawLib).join(', ') : 'undefined';
      console.log('[PAGE] exportToSvg not found. Keys:', keys);
      window.__ERROR__ = 'exportToSvg not found. Available: ' + keys;
      window.__READY__ = true;
      return;
    }

    console.log('[PAGE] calling exportToSvg...');
    const result = await exportFn({
      elements: JSON.parse(\`${elementsJson.replace(/\\/g, "\\\\")}\`),
      files: null,
      appState: { exportBackground: true, viewBackgroundColor: '#ffffff' },
    });
    console.log('[PAGE] exportToSvg returned, type:', typeof result);

    let svgStr;
    if (result instanceof SVGElement) {
      svgStr = result.outerHTML;
    } else if (typeof result === 'string') {
      svgStr = result;
    } else {
      svgStr = new XMLSerializer().serializeToString(result);
    }
    console.log('[PAGE] SVG:', svgStr.length, 'bytes');
    window.__SVG__ = svgStr;
  } catch (err) {
    console.log('[PAGE] error:', err.message);
    window.__ERROR__ = err.message || String(err);
  }
  window.__READY__ = true;
})().catch(e => { console.log('[PAGE] fatal:', e.message); window.__ERROR__ = e.message; window.__READY__ = true; });
</script>
</body></html>`;

    try {
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (window as Record<string, unknown>).__READY__, { timeout: 60000 });

      const err = await page.evaluate(() => (window as Record<string, unknown>).__ERROR__);
      if (err) throw new Error(String(err));

      return await page.evaluate(() => (window as Record<string, unknown>).__SVG__) as string;
    } finally {
      await page.close();
    }
  });
}

async function renderExcalidrawFromSkeletons(skeletons: unknown[]): Promise<string> {
  const { browser } = await ensureBrowser();
  const port = await ensureServer();
  const page = await browser.newPage();

  const skeletonsJson = JSON.stringify(skeletons);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="http://localhost:${port}/react.production.min.js"></script>
<script src="http://localhost:${port}/react-dom.production.min.js"></script>
<script src="http://localhost:${port}/excalidraw.min.js"></script>
</head>
<body>
<script>
(async () => {
  try {
    let attempts = 0;
    while (!window.ExcalidrawLib && attempts < 100) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    if (!window.ExcalidrawLib) {
      throw new Error('ExcalidrawLib not loaded');
    }

    const lib = window.ExcalidrawLib;
    const input = JSON.parse(${JSON.stringify(JSON.stringify(skeletons))});
    const elements = typeof lib.convertToExcalidrawElements === 'function'
      ? lib.convertToExcalidrawElements(input)
      : input;

    const svgResult = await lib.exportToSvg({
      elements,
      files: null,
      appState: { exportBackground: true, viewBackgroundColor: '#ffffff' },
    });

    if (svgResult instanceof SVGElement) {
      window.__SVG__ = svgResult.outerHTML;
    } else if (typeof svgResult === 'string') {
      window.__SVG__ = svgResult;
    } else {
      window.__SVG__ = new XMLSerializer().serializeToString(svgResult);
    }
  } catch (err) {
    window.__ERROR__ = String(err);
  }
  window.__READY__ = true;
})();
</script>
</body></html>`;

  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as Record<string, unknown>).__READY__, { timeout: 60000 });

    const err = await page.evaluate(() => (window as Record<string, unknown>).__ERROR__);
    if (err) throw new Error(String(err));

    return await page.evaluate(() => (window as Record<string, unknown>).__SVG__) as string;
  } finally {
    await page.close();
  }
}

// ── Path B: Dagre SVG ─────────────────────────────────────────────────────────

async function pathBDagre(definition: string): Promise<string> {
  const { parseMermaid }         = await import("../../packages/diagram/dist/parser/adapter.js");
  const { computeInitialLayout }  = await import("../../packages/diagram/dist/layout/auto-layout.js");
  const { generateCanvas }        = await import("../../packages/diagram/dist/canvas/canvas-generator.js");
  const { toExcalidrawPayload }  = await import("../../packages/diagram/dist/webview/scene-adapter.js");

  const parseResult = await parseMermaid(definition);
  if (!parseResult.valid || !parseResult.diagram) {
    throw new Error("Parse failed: " + (parseResult.error?.message ?? "unknown"));
  }

  const layout   = computeInitialLayout(parseResult.diagram);
  const scene    = generateCanvas(parseResult.diagram, layout);
  const elements = toExcalidrawPayload(scene.elements);

  return renderExcalidrawSvg(elements);
}

// ── Path C: Excalidraw SVG (upstream-direct) ──────────────────────────────────
// Uses Playwright to call parseMermaidToExcalidraw in a browser context, then
// uses ExcalidrawLib.convertToExcalidrawElements + exportToSvg to render.
// No dagre remap, no generateCanvas — true upstream output.
async function pathCExcalidraw(definition: string): Promise<string> {
  return withClosedBrowserRetry(async () => {
    const { browser } = await ensureBrowser();
    const port = await ensureServer();
    const page = await browser.newPage();

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<script src="http://localhost:${port}/mermaid-to-excalidraw.js"></script>
</head>
<body>
<script>
(async () => {
  try {
    let attempts = 0;
    while (!window.MermaidToExcalidraw && attempts < 100) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }
    if (!window.MermaidToExcalidraw) {
      throw new Error('MermaidToExcalidraw not loaded');
    }

    const { parseMermaidToExcalidraw } = window.MermaidToExcalidraw;
    const result = await parseMermaidToExcalidraw(${JSON.stringify(definition)});
    window.__SKELETONS__ = JSON.stringify(result.elements || []);
  } catch (err) {
    window.__ERROR__ = String(err);
  }
  window.__READY__ = true;
})();
</script>
</body></html>`;

    try {
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => (window as Record<string, unknown>).__READY__, { timeout: 60000 });

      const err = await page.evaluate(() => (window as Record<string, unknown>).__ERROR__);
      if (err) throw new Error(String(err));

      const skeletonsJson = await page.evaluate(
        () => (window as Record<string, unknown>).__SKELETONS__
      ) as string;

      const skeletons = JSON.parse(skeletonsJson);
      return await renderExcalidrawFromSkeletons(skeletons);
    } finally {
      await page.close();
    }
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RenderResult {
  caseName: string;
  caseIndex: number;
  svgMermaid: string;
  svgDagre: string;
  svgExcalidraw: string;
  error?: string;
}

export async function renderAllPaths(
  definition: string,
  caseName: string,
  caseIndex: number
): Promise<RenderResult> {
  let svgMermaid    = "";
  let svgDagre     = "";
  let svgExcalidraw = "";
  let error: string | undefined;

  try {
    svgMermaid = await pathAMermaid(definition);
  } catch (err) {
    error = "Mermaid: " + (err instanceof Error ? err.message : String(err));
  }

  try {
    svgDagre = await pathBDagre(definition);
  } catch (err) {
    error = (error ? error + "; " : "") + "Dagre: " + (err instanceof Error ? err.message : String(err));
  }

  try {
    svgExcalidraw = await pathCExcalidraw(definition);
  } catch (err) {
    error = (error ? error + "; " : "") + "Excalidraw: " + (err instanceof Error ? err.message : String(err));
  }

  return { caseName, caseIndex, svgMermaid, svgDagre, svgExcalidraw, error };
}

export async function cleanup() {
  if (_browser) { await _browser.close(); _browser = null; }
  if (_server)   { _server.close(); _server = null; }
  _playwright = null;
}

/**
 * state-render.ts
 * Renders stateDiagram-v2 test cases through two paths:
 *  - Path M: Mermaid native SVG via Playwright
 *  - Path A: Accordo engine SVG via layoutWithExcalidraw + toExcalidrawPayload + Playwright
 *
 * Architecture mirrors render.ts for flowcharts.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { existsSync, readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const DIAGRAM_MODULES = join(ROOT, "packages/diagram/node_modules");

const MERMAID_LIB    = join(DIAGRAM_MODULES, "mermaid/dist/mermaid.min.js");
const REACT_UMD      = join(DIAGRAM_MODULES, "react/umd/react.production.min.js");
const REACT_DOM_UMD  = join(DIAGRAM_MODULES, "react-dom/umd/react-dom.production.min.js");
const EXCALIDRAW_UMD = join(DIAGRAM_MODULES, "@excalidraw/excalidraw/dist/excalidraw.production.min.js");

// ── HTTP server ────────────────────────────────────────────────────────────────

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
        "/mermaid.min.js":         MERMAID_LIB,
        "/react.production.min.js":  REACT_UMD,
        "/react-dom.production.min.js": REACT_DOM_UMD,
        "/excalidraw.min.js":      EXCALIDRAW_UMD,
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
  if (_browser) { try { await _browser.close(); } catch { /* ignore */ } }
  _browser = null;
}

async function withClosedBrowserRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = String(err);
    const isClosed = msg.includes("has been closed") || msg.includes("Target page") || msg.includes("Browser has been closed");
    if (!isClosed) throw err;
    await resetBrowser();
    return await fn();
  }
}

// ── Excalidraw SVG export via Playwright ───────────────────────────────────────

async function renderExcalidrawSvg(elements: unknown[]): Promise<string> {
  return withClosedBrowserRetry(async () => {
    const { browser } = await ensureBrowser();
    const port = await ensureServer();
    const page = await browser.newPage();
    const elementsJson = JSON.stringify(elements);

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
      await new Promise(r => setTimeout(r, 100)); attempts++;
    }
    if (!window.ExcalidrawLib) throw new Error('ExcalidrawLib not loaded');

    const lib = window.ExcalidrawLib;
    const input = JSON.parse(\`${elementsJson.replace(/\\/g, "\\\\")}\`);
    const els = typeof lib.convertToExcalidrawElements === 'function'
      ? lib.convertToExcalidrawElements(input)
      : input;

    const svgResult = await lib.exportToSvg({
      elements: els,
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
  } catch (err) { window.__ERROR__ = String(err); }
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
  });
}

// ── Path M: Mermaid SVG via Playwright ─────────────────────────────────────────

async function pathStateMermaid(definition: string): Promise<string> {
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

// ── Path A: Accordo engine SVG via layoutWithExcalidraw ───────────────────────

async function pathStateAccordo(definition: string): Promise<string> {
  // Import from dist (must be built first)
  const { parseMermaid } = await import("../../packages/diagram/dist/parser/adapter.js");
  const { layoutWithExcalidraw } = await import("../../packages/diagram/dist/layout/excalidraw-engine.js");
  const { toExcalidrawPayload } = await import("../../packages/diagram/dist/webview/scene-adapter.js");

  const parseResult = await parseMermaid(definition);
  if (!parseResult.valid || !parseResult.diagram) {
    throw new Error("Parse failed: " + (parseResult.error?.message ?? "unknown"));
  }

  // layoutWithExcalidraw works for both flowchart and stateDiagram-v2
  const layout = await layoutWithExcalidraw(definition, parseResult.diagram);

  // Convert layout to Excalidraw elements using the scene adapter
  // We need to generate canvas elements from the layout
  const { generateCanvas } = await import("../../packages/diagram/dist/canvas/canvas-generator.js");
  const scene = generateCanvas(parseResult.diagram, layout);
  const elements = toExcalidrawPayload(scene.elements);

  return renderExcalidrawSvg(elements);
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface StateRenderResult {
  name: string;
  filename: string;
  caseIndex: number;
  svgMermaid: string;
  svgAccordo: string;
  error?: string;
}

export async function renderStateAllPaths(
  filename: string,
  definition: string,
  name: string,
  caseIndex: number
): Promise<StateRenderResult> {
  let svgMermaid = "";
  let svgAccordo = "";
  let error: string | undefined;

  try {
    svgMermaid = await pathStateMermaid(definition);
  } catch (err) {
    error = "Mermaid: " + (err instanceof Error ? err.message : String(err));
  }

  try {
    svgAccordo = await pathStateAccordo(definition);
  } catch (err) {
    error = (error ? error + "; " : "") + "Accordo: " + (err instanceof Error ? err.message : String(err));
  }

  return { name, filename, caseIndex, svgMermaid, svgAccordo, error };
}

export async function stateCleanup() {
  if (_browser) { await _browser.close(); _browser = null; }
  if (_server)   { _server.close(); _server = null; }
  _playwright = null;
}
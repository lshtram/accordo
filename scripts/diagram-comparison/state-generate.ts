/**
 * state-generate.ts
 * Generates the state diagram comparison HTML page.
 *
 * Compares Mermaid native SVG vs Accordo engine SVG for all 11 state diagrams.
 * Output: scripts/diagram-comparison/state-results.json and state-index.html
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { STATE_TEST_CASES } from "./state-cases.js";
import { renderStateAllPaths, stateCleanup } from "./state-render.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ─────────────────────────────────────────────────────────────────────

interface StateCaseResult {
  caseIndex: number;
  name: string;
  filename: string;
  definition: string;
  svgMermaid: string;
  svgAccordo: string;
  judgment: "PASS" | "WARN" | "FAIL";
  error?: string;
}

interface Summary {
  total: number;
  pass: number;
  warn: number;
  fail: number;
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(str: string, maxLen = 1000): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "... [truncated]";
}

// ── Semantic label extraction (works for both Mermaid and Accordo) ─────────────

function getMermaidLabels(svg: string): Set<string> {
  const labels = new Set<string>();
  // Mermaid uses foreignObject with <p> tags and id='state-NAME'
  const pMatches = svg.matchAll(/<p[^>]*>([\w][\w\s]{1,30})<\/p>/g);
  for (const m of pMatches) labels.add(m[1]!.trim());
  const idMatches = svg.matchAll(/id='state-([^-]+)'/g);
  for (const m of idMatches) labels.add(m[1]!.trim());
  // nested state IDs like state-First-fir → extract 'fir'
  const nestedMatches = svg.matchAll(/id='state-[^-]+-([^']+)'/g);
  for (const m of nestedMatches) {
    const name = m[1]!.trim();
    if (name && !/^\d+$/.test(name)) labels.add(name);
  }
  return labels;
}

function getAccordoLabels(svg: string): Set<string> {
  const labels = new Set<string>();
  const matches = svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g);
  for (const m of matches) {
    const text = m[1]!.trim();
    if (text.length > 1 && text.length < 50) labels.add(text);
  }
  return labels;
}

function semanticMatch(svgM: string, svgA: string): { pass: boolean; warn: boolean; mLabels: string[]; aLabels: string[] } {
  const mLabels = getMermaidLabels(svgM);
  const aLabels = getAccordoLabels(svgA);
  const shared = [...mLabels].filter(l => aLabels.has(l));

  if (!mLabels.size) {
    return { pass: false, warn: true, mLabels: [], aLabels: [...aLabels] };
  }
  const coverage = shared.length / mLabels.size;
  return {
    pass: coverage >= 1.0,
    warn: coverage >= 0.7 && coverage < 1.0,
    mLabels: [...mLabels],
    aLabels: [...aLabels]
  };
}

// Fix SVG dimensions: Mermaid SVGs have width="100%" but no height,
// causing them to collapse to 0 height in browsers. Replace with
// explicit pixel dimensions from viewBox so they render correctly.
function fixSvgDimensions(svg: string, w: number, h: number): string {
  if (!svg) return svg;
  let fixed = svg;

  // Replace width="100%" with actual pixel width (from viewBox)
  if (fixed.includes('width="100%"')) {
    fixed = fixed.replace('width="100%"', `width="${w}"`);
  }

  // Check if SVG root element has a height attribute by looking at the opening <svg> tag
  // We must check only the SVG root tag, not nested elements that also have height=
  const svgTagMatch = fixed.match(/<svg([^>]*)>/);
  if (svgTagMatch) {
    const svgTagAttrs = svgTagMatch[1]!; // everything between <svg and >
    if (!svgTagAttrs.includes('height=')) {
      // Add height attribute to the SVG root tag
      fixed = fixed.replace(/<svg([^>]*)>/, `<svg$1 height="${h}">`);
    }
  }

  return fixed;
}

// ── SVG dimension helpers ──────────────────────────────────────────────────────

function svgDimensions(svg: string): { w: number; h: number } | null {
  // Use viewBox for physical dimensions, regardless of CSS width="100%"
  const m = svg.match(/viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/);
  if (!m) return null;
  return { w: parseFloat(m[1]!), h: parseFloat(m[2]!) };
}

function svgViewBoxAspect(svg: string): number | null {
  const m = svg.match(/viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/);
  if (!m) return null;
  return parseFloat(m[1]!) / parseFloat(m[2]!);
}

function verdictBadge(verdict: "PASS" | "WARN" | "FAIL"): string {
  const colors = { PASS: "#22c55e", WARN: "#f59e0b", FAIL: "#ef4444" };
  const c = colors[verdict] ?? "#888";
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;color:white;background:${c}">${verdict}</span>`;
}

function generateHtml(results: StateCaseResult[], summary: Summary): string {
  const sorted = [...results].sort((a, b) => {
    const order = { FAIL: 0, WARN: 1, PASS: 2 };
    return order[a.judgment] - order[b.judgment];
  });

  const caseCards = sorted.map((r) => {
    const dimsM = svgDimensions(r.svgMermaid);
    const dimsA = svgDimensions(r.svgAccordo);
    const match = semanticMatch(r.svgMermaid, r.svgAccordo);
    const shared = match.mLabels.filter(l => new Set(match.aLabels).has(l));
    const matchBadge = match.pass
      ? `<div class="sim-badge" style="color:#22c55e">✓ ${shared.length}/${match.mLabels.length} labels matched</div>`
      : match.warn
      ? `<div class="sim-badge" style="color:#f59e0b">~ ${shared.length}/${match.mLabels.length} labels matched</div>`
      : `<div class="sim-badge" style="color:#ef4444">✗ ${shared.length}/${match.mLabels.length} labels matched</div>`;

    const fixedMermaid = r.svgMermaid ? fixSvgDimensions(r.svgMermaid, dimsM.w, dimsM.h) : "";
    const fixedAccordo = r.svgAccordo ? fixSvgDimensions(r.svgAccordo, dimsA.w, dimsA.h) : "";
    return `
    <div class="case-card" data-verdict="${r.judgment}">
      <div class="case-header">
        <div class="case-title">
          <span class="case-number">#${r.caseIndex + 1}</span>
          <span class="case-name">${escapeHtml(r.name)}</span>
          ${verdictBadge(r.judgment)}
        </div>
        <div class="case-src">${escapeHtml(r.definition.slice(0, 80))}${r.definition.length > 80 ? "..." : ""}</div>
        <div class="case-toggle">&#9658;</div>
      </div>
      <div class="case-body">
        <div class="col">
          <div class="col-label">Mermaid native</div>
          <div class="svg-wrap">${fixedMermaid || "<div class=err>render failed</div>"}</div>
          <div class="col-meta">${dimsM ? `${dimsM.w}×${dimsM.h}` : "—"}</div>
        </div>
        <div class="col">
          <div class="col-label">Accordo engine</div>
          <div class="svg-wrap">${fixedAccordo || "<div class=err>render failed</div>"}</div>
          <div class="col-meta">${dimsA ? `${dimsA.w}×${dimsA.h}` : "—"}</div>
        </div>
        <div class="col-meta-right">
          ${matchBadge}
          ${r.error ? `<div class="err-badge">${escapeHtml(r.error)}</div>` : ""}
        </div>
      </div>
    </div>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>State Diagram Fidelity — Mermaid vs Accordo Engine</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 24px 16px 80px; }
  h1 { text-align: center; font-size: 1.4rem; font-weight: 600; color: #fff; margin-bottom: 6px; }
  .subtitle { text-align: center; color: #888; font-size: 0.8rem; margin-bottom: 28px; }
  .summary-bar { display: flex; gap: 2rem; justify-content: center; margin-bottom: 28px; flex-wrap: wrap; }
  .summary-item { display: flex; align-items: center; gap: 0.5rem; }
  .summary-count { font-size: 1.5rem; font-weight: 700; }
  .summary-label { font-size: 0.85rem; color: #aaa; }
  .pass .summary-count { color: #22c55e; }
  .warn .summary-count { color: #f59e0b; }
  .fail .summary-count { color: #ef4444; }
  .case-card { background: #232340; border: 1px solid #3a3a5c; border-radius: 10px; margin-bottom: 20px; overflow: hidden; }
  .case-header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #1e1e38; border-bottom: 1px solid #3a3a5c; cursor: pointer; user-select: none; }
  .case-header:hover { background: #282850; }
  .case-number { font-size: 0.7rem; font-weight: 700; color: #fff; background: #4a4a80; border-radius: 4px; padding: 2px 7px; min-width: 32px; text-align: center; }
  .case-name { font-size: 0.85rem; color: #c0c0d8; flex: 1; font-family: 'Courier New', monospace; }
  .case-src { font-size: 0.72rem; color: #7878a0; max-width: 300px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .case-toggle { color: #666; font-size: 0.8rem; transition: transform 0.2s; }
  .case.open .case-toggle { transform: rotate(90deg); }
  .case-body { display: none; padding: 16px; gap: 16px; }
  .case.open .case-body { display: flex; }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
  .col-label { font-size: 0.7rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
  .svg-wrap { width: 100%; max-width: 500px; border: 1px solid #3a3a5c; border-radius: 6px; overflow: hidden; background: #fff; }
  .svg-wrap svg { display: block; width: 100%; height: auto; }
  .col-meta { font-size: 0.65rem; color: #666; }
  .col-meta-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; justify-content: center; }
  .sim-badge { font-size: 0.75rem; color: #aaa; background: #2a2a4a; padding: 4px 10px; border-radius: 4px; }
  .err { color: #ef4444; padding: 20px; text-align: center; font-size: 0.8rem; }
  .err-badge { font-size: 0.7rem; color: #ef4444; background: #3a1a1a; padding: 4px 8px; border-radius: 4px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .filter-bar { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; justify-content: center; }
  .filter-btn { padding: 4px 12px; border-radius: 6px; font-size: 0.8rem; cursor: pointer; border: 1px solid #3a3a5c; background: #232340; color: #888; }
  .filter-btn.active { background: #4a4a80; color: #fff; border-color: #6a6ab0; }
</style>
</head>
<body>
<h1>State Diagram Fidelity</h1>
<p class="subtitle">Mermaid native SVG vs Accordo upstream engine — ${summary.total} diagrams</p>

<div class="summary-bar">
  <div class="summary-item pass"><span class="summary-count">${summary.pass}</span><span class="summary-label">pass</span></div>
  <div class="summary-item warn"><span class="summary-count">${summary.warn}</span><span class="summary-label">warn</span></div>
  <div class="summary-item fail"><span class="summary-count">${summary.fail}</span><span class="summary-label">fail</span></div>
</div>

<div class="filter-bar">
  <button class="filter-btn active" onclick="filterAll()">All</button>
  <button class="filter-btn" onclick="filterVerdict('PASS')">Pass</button>
  <button class="filter-btn" onclick="filterVerdict('FAIL')">Fail</button>
</div>

<div class="cases">
${caseCards}
</div>

<script>
  document.querySelectorAll('.case-header').forEach(h => {
    h.addEventListener('click', () => {
      h.closest('.case-card').classList.toggle('open');
    });
  });

  function filterAll() {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.filter-btn').classList.add('active');
    document.querySelectorAll('.case-card').forEach(c => c.style.display = '');
  }

  function filterVerdict(v) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.case-card').forEach(c => {
      c.style.display = c.dataset.verdict === v ? '' : 'none';
    });
  }
</script>
</body>
</html>`;
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("State diagram comparison generator");
  console.log(`Found ${STATE_TEST_CASES.length} test cases`);

  const results: StateCaseResult[] = [];
  let pass = 0, warn = 0, fail = 0;

  for (let i = 0; i < STATE_TEST_CASES.length; i++) {
    const tc = STATE_TEST_CASES[i]!;
    process.stdout.write(`[${i + 1}/${STATE_TEST_CASES.length}] ${tc.name}... `);

    const result = await renderStateAllPaths(tc.filename, tc.definition, tc.name, i);

    // Determine judgment based on semantic label matching (not shape structure)
    let judgment: "PASS" | "WARN" | "FAIL" = "PASS";
    if (result.error) {
      judgment = "FAIL";
    } else {
      const match = semanticMatch(result.svgMermaid, result.svgAccordo);
      if (match.warn && !match.pass) judgment = "WARN";
      else if (!match.warn && !match.pass) judgment = "FAIL";
    }

    if (judgment === "PASS") pass++;
    else if (judgment === "WARN") warn++;
    else fail++;

    results.push({ ...result, definition: tc.definition, judgment });

    if (result.error) {
      console.log(`ERROR: ${result.error}`);
    } else {
      const match = semanticMatch(result.svgMermaid, result.svgAccordo);
      const mLabels = match.mLabels;
      const aLabels = match.aLabels;
      const shared = mLabels.filter(l => new Set(aLabels).has(l));
      console.log(`OK | Mermaid labels: ${mLabels.length} | Accordo labels: ${aLabels.length} | Shared: ${shared.join(', ')}`);
    }
  }

  const summary: Summary = { total: results.length, pass, warn, fail };

  // Write results.json
  const resultsPath = join(__dirname, "state-results.json");
  writeFileSync(resultsPath, JSON.stringify({ results, summary }, null, 2));
  console.log(`\nResults written to ${resultsPath}`);

  // Write HTML
  const htmlPath = join(__dirname, "state-index.html");
  writeFileSync(htmlPath, generateHtml(results, summary));
  console.log(`HTML written to ${htmlPath}`);

  console.log(`\nSummary: ${pass} pass, ${warn} warn, ${fail} fail`);

  await stateCleanup();
}

main().catch((err) => {
  console.error("Fatal:", err);
  stateCleanup();
  process.exit(1);
});
/**
 * generate.ts
 * Main entry point: runs all 52 cases through render + LLM,
 * writes results.json and index.html.
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { cleanup } from "./render.ts";

import { FLOWCHART_DIAGRAM_TESTCASES } from "./cases.ts";
import { renderAllPaths, type RenderResult } from "./render.ts";
import { askLlmJudgment, structuralComparison, type LlmJudgment } from "./llm.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CaseResult {
  caseIndex: number;
  name: string;
  type: "flowchart";
  definition: string;
  svgMermaid: string;
  svgDagre: string;
  svgExcalidraw: string;
  judgment: LlmJudgment;
  renderError?: string;
}

interface Summary {
  total: number;
  pass: number;
  warn: number;
  fail: number;
}

// ── HTML generation ───────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncateSvg(svg: string, maxLen = 500): string {
  if (svg.length <= maxLen) return svg;
  return svg.slice(0, maxLen) + "... [truncated]";
}

function verdictBadge(verdict: "PASS" | "WARN" | "FAIL"): string {
  const colors: Record<string, string> = {
    PASS: "#22c55e",
    WARN: "#f59e0b",
    FAIL: "#ef4444",
  };
  const color = colors[verdict] ?? "#888";
  return `<span style="
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    color: white;
    background: ${color};
  ">${verdict}</span>`;
}

function typeBadge(type: string): string {
  return `<span style="
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    color: #6366f1;
    background: #e0e7ff;
  ">${escapeHtml(type)}</span>`;
}

function generateHtml(results: CaseResult[], summary: Summary): string {
  // Sort: FAIL first, then WARN, then PASS
  const verdictOrder = { FAIL: 0, WARN: 1, PASS: 2 };
  const sorted = [...results].sort(
    (a, b) => verdictOrder[a.judgment.verdict] - verdictOrder[b.judgment.verdict]
  );

  const caseCards = sorted
    .map(
      (r) => `
    <div class="case-card" data-verdict="${r.judgment.verdict}">
      <div class="case-header">
        <div class="case-title">
          <span class="case-number">#${r.caseIndex + 1}</span>
          <span class="case-name">${escapeHtml(r.name)}</span>
          ${typeBadge(r.type)}
        </div>
        <div class="case-verdict">
          ${verdictBadge(r.judgment.verdict)}
        </div>
      </div>
      
      <div class="case-definition">
        <details>
          <summary>Mermaid Source</summary>
          <pre><code>${escapeHtml(r.definition)}</code></pre>
        </details>
      </div>
      
      <div class="case-svgs">
        <div class="svg-column">
          <div class="svg-label">Mermaid SVG</div>
          <div class="svg-container">${r.svgMermaid || "<em>Render failed</em>"}</div>
        </div>
        <div class="svg-column">
          <div class="svg-label">Dagre SVG</div>
          <div class="svg-container">${r.svgDagre || "<em>Render failed</em>"}</div>
        </div>
        <div class="svg-column">
          <div class="svg-label">Excalidraw SVG</div>
          <div class="svg-container">${r.svgExcalidraw || "<em>Render failed</em>"}</div>
        </div>
      </div>
      
      <div class="case-explanation">
        <strong>Explanation:</strong> ${escapeHtml(r.judgment.explanation)}
        ${r.renderError ? `<br><strong>Render errors:</strong> <code>${escapeHtml(r.renderError)}</code>` : ""}
      </div>
    </div>
  `
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Diagram Comparison: Mermaid vs Dagre vs Excalidraw</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      color: #1f2937;
      background: #f8fafc;
    }
    
    .header {
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      color: white;
      padding: 2rem;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    
    .header h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
    }
    
    .header p {
      opacity: 0.9;
      font-size: 0.9rem;
    }
    
    .summary-bar {
      display: flex;
      gap: 1.5rem;
      margin-top: 1rem;
      flex-wrap: wrap;
    }
    
    .summary-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .summary-count {
      font-size: 1.25rem;
      font-weight: 700;
    }
    
    .summary-label {
      font-size: 0.875rem;
      opacity: 0.9;
    }
    
    .summary-pass .summary-count { color: #86efac; }
    .summary-warn .summary-count { color: #fcd34d; }
    .summary-fail .summary-count { color: #fca5a5; }
    
    .main {
      max-width: 1400px;
      margin: 0 auto;
      padding: 1.5rem;
    }
    
    .filter-bar {
      margin-bottom: 1.5rem;
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    
    .filter-btn {
      padding: 0.5rem 1rem;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: white;
      cursor: pointer;
      font-size: 0.875rem;
      transition: all 0.15s;
    }
    
    .filter-btn:hover {
      background: #f3f4f6;
    }
    
    .filter-btn.active {
      background: #4f46e5;
      color: white;
      border-color: #4f46e5;
    }
    
    .case-card {
      background: white;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      border-left: 4px solid #e5e7eb;
    }
    
    .case-card[data-verdict="PASS"] { border-left-color: #22c55e; }
    .case-card[data-verdict="WARN"] { border-left-color: #f59e0b; }
    .case-card[data-verdict="FAIL"] { border-left-color: #ef4444; }
    
    .case-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
      gap: 1rem;
    }
    
    .case-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    
    .case-number {
      font-size: 0.75rem;
      font-weight: 600;
      color: #6b7280;
      background: #f3f4f6;
      padding: 2px 8px;
      border-radius: 4px;
    }
    
    .case-name {
      font-size: 1rem;
      font-weight: 600;
    }
    
    .case-definition {
      margin-bottom: 1rem;
    }
    
    .case-definition details {
      background: #f9fafb;
      border-radius: 6px;
      overflow: hidden;
    }
    
    .case-definition summary {
      padding: 0.5rem 1rem;
      cursor: pointer;
      font-size: 0.875rem;
      color: #6b7280;
      font-weight: 500;
    }
    
    .case-definition pre {
      padding: 1rem;
      overflow-x: auto;
      font-size: 0.8rem;
      line-height: 1.6;
      margin: 0;
    }
    
    .case-definition code {
      font-family: "SF Mono", Monaco, monospace;
    }
    
    .case-svgs {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 1rem;
    }
    
    @media (max-width: 900px) {
      .case-svgs {
        grid-template-columns: 1fr;
      }
    }
    
    .svg-column {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .svg-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    .svg-container {
      background: #fafafa;
      border-radius: 8px;
      padding: 1rem;
      min-height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    
    .svg-container svg {
      max-width: 100%;
      height: auto;
      max-height: 300px;
    }
    
    .svg-container em {
      color: #9ca3af;
      font-style: italic;
    }
    
    .case-explanation {
      font-size: 0.875rem;
      color: #4b5563;
      padding-top: 1rem;
      border-top: 1px solid #f3f4f6;
    }
    
    .case-explanation code {
      font-size: 0.8rem;
      background: #fef3c7;
      padding: 1px 4px;
      border-radius: 3px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Diagram Comparison Pipeline</h1>
    <p>Mermaid SVG vs Accordo Dagre Engine vs Accordo Excalidraw Engine</p>
    <div class="summary-bar">
      <div class="summary-item summary-pass">
        <span class="summary-count">${summary.pass}</span>
        <span class="summary-label">PASS</span>
      </div>
      <div class="summary-item summary-warn">
        <span class="summary-count">${summary.warn}</span>
        <span class="summary-label">WARN</span>
      </div>
      <div class="summary-item summary-fail">
        <span class="summary-count">${summary.fail}</span>
        <span class="summary-label">FAIL</span>
      </div>
      <div class="summary-item">
        <span class="summary-count">${summary.total}</span>
        <span class="summary-label">Total</span>
      </div>
    </div>
  </div>
  
  <div class="main">
    <div class="filter-bar">
      <button class="filter-btn active" onclick="filterCases('all')">All (${summary.total})</button>
      <button class="filter-btn" onclick="filterCases('FAIL')">FAIL (${summary.fail})</button>
      <button class="filter-btn" onclick="filterCases('WARN')">WARN (${summary.warn})</button>
      <button class="filter-btn" onclick="filterCases('PASS')">PASS (${summary.pass})</button>
    </div>
    
    ${caseCards}
  </div>
  
  <script>
    function filterCases(verdict) {
      const cards = document.querySelectorAll('.case-card');
      const buttons = document.querySelectorAll('.filter-btn');
      
      buttons.forEach(btn => btn.classList.remove('active'));
      event.target.classList.add('active');
      
      cards.forEach(card => {
        if (verdict === 'all' || card.dataset.verdict === verdict) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>`;
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function runPipeline() {
  console.log("Diagram Comparison Pipeline");
  console.log("==========================\n");
  
  const outDir = __dirname;
  const resultsPath = join(outDir, "results.json");
  const htmlPath = join(outDir, "index.html");
  
  const results: CaseResult[] = [];
  
  console.log(`Processing ${FLOWCHART_DIAGRAM_TESTCASES.length} test cases...\n`);
  
  for (let i = 0; i < FLOWCHART_DIAGRAM_TESTCASES.length; i++) {
    const tc = FLOWCHART_DIAGRAM_TESTCASES[i];
    process.stdout.write(`[${i + 1}/${FLOWCHART_DIAGRAM_TESTCASES.length}] ${tc.name}... `);
    
    try {
      // Render all 3 paths
      const renderResult: RenderResult = await renderAllPaths(
        tc.definition,
        tc.name,
        i
      );
      
      // Get LLM judgment (or fallback to structural comparison)
      let judgment: LlmJudgment;
      if (renderResult.svgMermaid && renderResult.svgDagre && renderResult.svgExcalidraw) {
        try {
          judgment = await askLlmJudgment(
            renderResult.svgMermaid,
            renderResult.svgDagre,
            renderResult.svgExcalidraw
          );
        } catch {
          // Fallback to structural comparison
          judgment = structuralComparison(
            renderResult.svgMermaid,
            renderResult.svgDagre,
            renderResult.svgExcalidraw
          );
        }
      } else {
        judgment = structuralComparison(
          renderResult.svgMermaid,
          renderResult.svgDagre,
          renderResult.svgExcalidraw
        );
        judgment.explanation = `Render failed: ${renderResult.error}. ${judgment.explanation}`;
      }
      
      results.push({
        caseIndex: i,
        name: tc.name,
        type: tc.type,
        definition: tc.definition,
        svgMermaid: renderResult.svgMermaid,
        svgDagre: renderResult.svgDagre,
        svgExcalidraw: renderResult.svgExcalidraw,
        judgment,
        renderError: renderResult.error,
      });
      
      console.log(`${judgment.verdict}`);
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
      results.push({
        caseIndex: i,
        name: tc.name,
        type: tc.type,
        definition: tc.definition,
        svgMermaid: "",
        svgDagre: "",
        svgExcalidraw: "",
        judgment: {
          verdict: "FAIL",
          explanation: `Pipeline error: ${err instanceof Error ? err.message : String(err)}`,
        },
        renderError: String(err),
      });
    }
  }
  
  // Compute summary
  const summary: Summary = {
    total: results.length,
    pass: results.filter((r) => r.judgment.verdict === "PASS").length,
    warn: results.filter((r) => r.judgment.verdict === "WARN").length,
    fail: results.filter((r) => r.judgment.verdict === "FAIL").length,
  };
  
  console.log(`\n\nSummary:`);
  console.log(`  PASS: ${summary.pass}`);
  console.log(`  WARN: ${summary.warn}`);
  console.log(`  FAIL: ${summary.fail}`);
  console.log(`  Total: ${summary.total}`);
  
  // Write results.json
  console.log(`\nWriting results.json...`);
  writeFileSync(resultsPath, JSON.stringify({ summary, results }, null, 2), "utf-8");
  
  // Write index.html
  console.log(`Writing index.html...`);
  const html = generateHtml(results, summary);
  writeFileSync(htmlPath, html, "utf-8");
  
  console.log(`\nDone!`);
  console.log(`  - ${resultsPath}`);
  console.log(`  - ${htmlPath}`);
  
  // Clean up browser resources
  await cleanup();
  
  return { summary, results };
}

runPipeline().catch(async (err) => {
  console.error("Fatal error:", err);
  await cleanup();
  process.exit(1);
});

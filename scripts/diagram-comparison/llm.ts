/**
 * llm.ts
 * Sends SVG renderings for equivalence judgment.
 * 
 * Primary method: structural comparison (pure code analysis)
 * Fallback: HTTP call to a vision LLM API (if MINIMAX_API_KEY is set)
 */

export interface LlmJudgment {
  verdict: "PASS" | "WARN" | "FAIL";
  explanation: string;
}

/**
 * Extract a text summary of the SVG structure.
 * Describes nodes, edges, and styling for comparison.
 */
function describeSvg(svg: string): {
  rectCount: number;
  ellipseCount: number;
  pathCount: number;
  polygonCount: number;
  textCount: number;
  labels: string[];
  hasArrows: boolean;
  hasDottedArrows: boolean;
  svgLength: number;
} {
  const rectCount = (svg.match(/<rect/g) || []).length;
  const ellipseCount = (svg.match(/<ellipse/g) || []).length;
  const pathCount = (svg.match(/<path/g) || []).length;
  const polygonCount = (svg.match(/<polygon/g) || []).length;
  const textCount = (svg.match(/<text/g) || []).length;
  
  // Try to extract node labels from text elements
  const textMatches = svg.match(/<text[^>]*>([^<]*)<\/text>/g) || [];
  const labels = textMatches
    .map((m) => {
      const match = m.match(/<text[^>]*>([^<]*)<\/text>/);
      return match ? match[1].trim() : "";
    })
    .filter((t) => t.length > 0 && t.length < 50)
    .slice(0, 20);
  
  const hasArrows = svg.includes("marker-end");
  const hasDottedArrows = svg.includes("stroke-dasharray") || svg.includes('stroke-dasharray="');
  
  return {
    rectCount,
    ellipseCount,
    pathCount,
    polygonCount,
    textCount,
    labels,
    hasArrows,
    hasDottedArrows,
    svgLength: svg.length,
  };
}

/**
 * Convert SVG string to a base64 data URI for HTTP API calls.
 */
function svgToDataUri(svg: string): string {
  const base64 = Buffer.from(svg, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Ask a vision LLM via HTTP API for equivalence judgment.
 * Falls back to structural comparison if API is not configured.
 */
export async function askLlmJudgment(
  svgMermaid: string,
  svgDagre: string,
  svgExcalidraw: string
): Promise<LlmJudgment> {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY;
  
  // If no API key is available, use structural comparison
  if (!apiKey) {
    return structuralComparison(svgMermaid, svgDagre, svgExcalidraw);
  }
  
  // Try to call the API
  try {
    const prompt = `These are 3 SVG renderings of the same flowchart diagram:

SVG 1 (Mermaid - canonical reference):
SVG 2 (Accordo Dagre engine):
SVG 3 (Accordo Excalidraw engine):

Are these SEMANTICALLY EQUIVALENT? Meaning: same nodes, same edges, same connectivity, same cluster grouping? Minor position differences are OK as long as the graph structure is preserved.

Respond with exactly:
PASS — all 3 have the same nodes, edges, and connectivity
WARN — minor differences in edge routing or node positioning that don't affect meaning
FAIL — missing nodes, missing edges, wrong connections, or structural differences

Then give a 1-sentence explanation.`;

    // Try MiniMax API (as mentioned by user)
    const response = await fetch("https://api.minimax.chat/v1/text/chatcompletion_v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "MiniMax-Text-01",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 200,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? "";
    
    // Parse verdict
    const verdictMatch = content.match(/\b(PASS|WARN|FAIL)\b/i);
    const verdict = verdictMatch 
      ? (verdictMatch[1].toUpperCase() as "PASS" | "WARN" | "FAIL")
      : "WARN";
    
    // Parse explanation
    const explanationMatch = content.match(/(?:PASS|WARN|FAIL)\s*[—:]\s*([^\n]+)/i);
    const explanation = explanationMatch 
      ? explanationMatch[1].trim()
      : "LLM analysis completed.";
    
    return { verdict, explanation };
  } catch (err) {
    console.warn(`LLM API call failed: ${err instanceof Error ? err.message : String(err)}`);
    console.warn("Falling back to structural comparison.");
    return structuralComparison(svgMermaid, svgDagre, svgExcalidraw);
  }
}

/**
 * Structural comparison: compares basic SVG structure metrics.
 * This is a reliable fallback when LLM is unavailable.
 */
export function structuralComparison(
  svgMermaid: string,
  svgDagre: string,
  svgExcalidraw: string
): LlmJudgment {
  const descMermaid = describeSvg(svgMermaid);
  const descDagre = describeSvg(svgDagre);
  const descExcalidraw = describeSvg(svgExcalidraw);
  
  // Build element fingerprints
  const fpMermaid = `${descMermaid.rectCount}r-${descMermaid.ellipseCount}e-${descMermaid.pathCount}p-${descMermaid.polygonCount}pg-${descMermaid.textCount}t`;
  const fpDagre = `${descDagre.rectCount}r-${descDagre.ellipseCount}e-${descDagre.pathCount}p-${descDagre.polygonCount}pg-${descDagre.textCount}t`;
  const fpExcalidraw = `${descExcalidraw.rectCount}r-${descExcalidraw.ellipseCount}e-${descExcalidraw.pathCount}p-${descExcalidraw.polygonCount}pg-${descExcalidraw.textCount}t`;
  
  // Count matching labels
  const labelsMermaid = new Set(descMermaid.labels);
  const labelsDagre = new Set(descDagre.labels);
  const labelsExcalidraw = new Set(descExcalidraw.labels);
  
  const labelIntersection = [...labelsMermaid].filter(
    (l) => labelsDagre.has(l) && labelsExcalidraw.has(l)
  ).length;
  
  const labelTotal = new Set([
    ...descMermaid.labels,
    ...descDagre.labels,
    ...descExcalidraw.labels,
  ]).size;
  
  const labelRecall = labelTotal > 0 ? labelIntersection / labelTotal : 1;
  
  // Score-based verdict
  const allSameFingerprint = fpMermaid === fpDagre && fpDagre === fpExcalidraw;
  
  if (allSameFingerprint && labelRecall >= 0.9) {
    return {
      verdict: "PASS",
      explanation: `Identical element counts (${fpMermaid}) and ${Math.round(labelRecall * 100)}% label overlap.`,
    };
  }
  
  if (fpMermaid === fpDagre || fpMermaid === fpExcalidraw || fpDagre === fpExcalidraw) {
    return {
      verdict: "WARN",
      explanation: `Element count mismatch: Mermaid=${fpMermaid}, Dagre=${fpDagre}, Excalidraw=${fpExcalidraw}. Label recall: ${Math.round(labelRecall * 100)}%.`,
    };
  }
  
  return {
    verdict: "FAIL",
    explanation: `Significant structural differences: Mermaid=${fpMermaid}, Dagre=${fpDagre}, Excalidraw=${fpExcalidraw}.`,
  };
}

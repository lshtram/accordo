/**
 * Debug: dump the Excalidraw JSON payload to disk, immediately before it is
 * posted to the webview.  This gives you the exact scene that will be rendered,
 * with no transforms applied after the fact.
 *
 * Enable:  set ACCORDO_DEBUG_DIAGRAM_JSON=1 in the environment
 * Disable: unset or set to 0/false — function is a total no-op (zero cost)
 *
 * Output:  <workspaceRoot>/.accordo/diagrams/debug/<stem>.excalidraw.json
 *          (overwritten on every render — no timestamp suffix)
 *
 * The file is a valid Excalidraw scene document.  Open it at
 * https://excalidraw.com  or via the VS Code Excalidraw extension to inspect
 * the rendered output visually.
 *
 * Pure Node.js module — NO vscode import.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";

// ── Debug flag ────────────────────────────────────────────────────────────────

/**
 * Returns true when `ACCORDO_DEBUG_DIAGRAM_JSON` is set to a non-empty,
 * non-"0"/"false" value.  When false the entire dump is a no-op (zero cost).
 */
function isDebugEnabled(): boolean {
  const v = process.env["ACCORDO_DEBUG_DIAGRAM_JSON"];
  return v !== undefined && v !== "" && v !== "0" && v !== "false";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DumpOptions {
  /** Absolute path to the source .mmd file. */
  mmdPath: string;
  /** Workspace root — debug files are written relative to this. */
  workspaceRoot: string;
  /** Raw Mermaid source text. */
  source: string;
  /** The scene elements about to be posted to the webview (API or skeleton). */
  elements: unknown[];
}

// ── dumpExcalidrawJson ────────────────────────────────────────────────────────

/**
 * Write a `.excalidraw.json` snapshot to `.accordo/diagrams/debug/` using the
 * elements that are *about to be posted* to the webview.
 *
 * The function is a no-op when `ACCORDO_DEBUG_DIAGRAM_JSON` is not set.
 * Errors are swallowed so a debug-write failure never interrupts rendering.
 */
export async function dumpExcalidrawJson(opts: DumpOptions): Promise<void> {
  if (!isDebugEnabled()) return;

  const { mmdPath, workspaceRoot, source, elements } = opts;

  const stem = basename(mmdPath, extname(mmdPath));
  const debugDir = join(workspaceRoot, ".accordo", "diagrams", "debug");
  const outPath = join(debugDir, `${stem}.excalidraw.json`);

  const scene = {
    type: "excalidraw",
    version: 2,
    source: mmdPath,
    mermaidSource: source,
    elements,
    appState: {
      viewBackgroundColor: "#ffffff",
    },
    files: {},
  };

  try {
    await mkdir(debugDir, { recursive: true });
    await writeFile(outPath, JSON.stringify(scene, null, 2), "utf8");
    process.stderr.write(`[accordo:diag:debug] dumped ${outPath}\n`);
  } catch (err) {
    // Debug dumps are non-fatal — never block rendering.
    process.stderr.write(`[accordo:diag:debug] dump FAILED: ${String(err)}\n`);
  }
}

/**
 * Debug flow logger for diagram load pipeline (Step 1..7 tracing).
 *
 * Enable with: ACCORDO_DEBUG_DIAGRAM_FLOW=1
 * Output file: <workspace>/.accordo/diagrams/debug/<stem>.flow.log
 *
 * Pure Node module (no vscode import).
 */

import { appendFile, mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

interface FlowLogEvent {
  workspaceRoot: string;
  mmdPath: string;
  stage: string;
  message: string;
  data?: unknown;
}

function enabled(): boolean {
  const v = process.env["ACCORDO_DEBUG_DIAGRAM_FLOW"];
  return v !== undefined && v !== "" && v !== "0" && v !== "false";
}

export async function appendDiagramFlowLog(evt: FlowLogEvent): Promise<void> {
  if (!enabled()) return;

  const stem = basename(evt.mmdPath, extname(evt.mmdPath));
  const debugDir = join(evt.workspaceRoot, ".accordo", "diagrams", "debug");
  const outPath = join(debugDir, `${stem}.flow.log`);
  const ts = new Date().toISOString();
  const payload = evt.data === undefined ? "" : ` ${JSON.stringify(evt.data)}`;
  const line = `${ts} [${evt.stage}] ${evt.message}${payload}\n`;

  try {
    await mkdir(debugDir, { recursive: true });
    await appendFile(outPath, line, "utf8");
  } catch {
    // Non-fatal debugging helper; never block rendering.
  }
}

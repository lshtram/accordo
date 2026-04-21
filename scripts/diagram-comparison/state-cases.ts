/**
 * state-cases.ts
 * The 11 stateDiagram-v2 test cases from demo/state/
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEMO_STATE = join(__dirname, "../../demo/state");

export interface StateTestCase {
  name: string;
  filename: string;
  definition: string;
  type: "stateDiagram-v2";
}

function loadStateMmd(filename: string): { name: string; definition: string } {
  const fullPath = join(DEMO_STATE, filename);
  const definition = readFileSync(fullPath, "utf-8").trim();
  // Derive name from filename: state-01-simple.mmd → "state-01 simple"
  const base = filename.replace(/\.mmd$/, "");
  const parts = base.split("-");
  // Skip the first two tokens (state-XX) and join the rest
  const name = parts.slice(2).join(" ") || parts.join(" ");
  return { name, definition };
}

export const STATE_TEST_CASES: StateTestCase[] = [
  { filename: "state-01-simple.mmd", ...loadStateMmd("state-01-simple.mmd"), type: "stateDiagram-v2" },
  { filename: "state-02-choice-notes.mmd", ...loadStateMmd("state-02-choice-notes.mmd"), type: "stateDiagram-v2" },
  { filename: "state-03-composite.mmd", ...loadStateMmd("state-03-composite.mmd"), type: "stateDiagram-v2" },
  { filename: "state-04-composite-transitions.mmd", ...loadStateMmd("state-04-composite-transitions.mmd"), type: "stateDiagram-v2" },
  { filename: "state-05-nested-composite.mmd", ...loadStateMmd("state-05-nested-composite.mmd"), type: "stateDiagram-v2" },
  { filename: "state-06-concurrency.mmd", ...loadStateMmd("state-06-concurrency.mmd"), type: "stateDiagram-v2" },
  { filename: "state-07-fork-join.mmd", ...loadStateMmd("state-07-fork-join.mmd"), type: "stateDiagram-v2" },
  { filename: "state-08-multiline-notes.mmd", ...loadStateMmd("state-08-multiline-notes.mmd"), type: "stateDiagram-v2" },
  { filename: "state-09-styling.mmd", ...loadStateMmd("state-09-styling.mmd"), type: "stateDiagram-v2" },
  { filename: "state-10-direction-comments.mmd", ...loadStateMmd("state-10-direction-comments.mmd"), type: "stateDiagram-v2" },
  { filename: "state-11-spaces-inline-styles.mmd", ...loadStateMmd("state-11-spaces-inline-styles.mmd"), type: "stateDiagram-v2" },
];
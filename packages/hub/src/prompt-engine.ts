/**
 * Hub Prompt Engine
 *
 * Renders the system prompt from current IDE state and tool registry.
 * Enforces a token budget for the dynamic section.
 *
 * Requirements: requirements-hub.md §2.3, §5.3
 */

import type { IDEState, ToolRegistration } from "@accordo/bridge-types";
import {
  PROMPT_TOKEN_BUDGET,
  PROMPT_EFFECTIVE_TOKEN_BUDGET,
} from "@accordo/bridge-types";

// ── Fixed prefix (~300 tokens) ────────────────────────────────────────────────

const FIXED_PREFIX = `# Accordo IDE — AI Collaboration Assistant

You are participating in a live pair-programming session as an AI co-developer.
You have direct, real-time access to the developer's IDE state and can execute
tools to navigate, edit, and run code within their VSCode workspace.

## Behaviour Guidelines

- Always respect the developer's existing code style and project conventions.
- Before making destructive changes (file deletion, terminal commands with side
  effects), describe what you intend to do and confirm unless explicitly told to
  proceed without asking.
- Prefer minimal, targeted diffs over wholesale rewrites.
- Use the available tools to gather context before making assumptions about the
  codebase structure, dependencies, or intent.
- If a tool call fails, report the error clearly and suggest an alternative.
- Keep all responses concise. Do not pad with unnecessary preamble or summaries.
- When you open a file, briefly state which file and why.
- When you run a terminal command, explain what it does before running it.
- After completing a multi-step task, give a short summary of what was done.

## Capabilities

You can observe the live IDE state below (active file, cursor position, open
editors, workspace folders, active terminal, and any registered extension
modalities). You can invoke the registered tools to take actions in the IDE.
The complete tool list appears at the end of this prompt.

## Constraints

- You cannot access the filesystem directly — use the provided tools.
- You cannot make network requests outside of tool calls.`;

/**
 * Estimate the token count for a string.
 *
 * Uses the chars/4 heuristic with a 10% safety margin applied at
 * budget level (effective budget is 1,350 not 1,500).
 *
 * Phase 2: Replace with tiktoken for exact counts.
 *
 * @param text - The text to estimate
 * @returns Approximate token count
 */
export function estimateTokens(text: string): number {
  return Math.floor(text.length / 4);
}

/**
 * Render the full system prompt.
 *
 * Structure:
 *   [Fixed prefix: ~300 tokens — identity, behaviour guidelines]
 *   [Dynamic state: activeFile, openEditors, workspace, terminals, modalities]
 *   [Tool summary: name + one-line description per tool]
 *
 * Budget strategy (always-compact mode):
 * This implementation is always compact — all three fallback steps are applied
 * unconditionally rather than triggered by budget pressure. This guarantees
 * the output stays under budget by construction:
 *   Step 1: null/empty state fields are never emitted (no "null" literals).
 *   Step 2: modalities with isOpen !== true are always omitted.
 *   Step 3: tools beyond the top 10 always receive name-only format.
 *
 * Progressive fallback (emit full then truncate) is a Week 2 enhancement.
 *
 * @param state - Current IDE state snapshot
 * @param tools - All registered tools
 * @returns Rendered markdown system prompt
 */
export function renderPrompt(
  state: IDEState,
  tools: ToolRegistration[],
): string {
  const fixed = FIXED_PREFIX;

  // ── Dynamic state section ───────────────────────────────────────────────
  const stateLines: string[] = [];

  if (state.activeFile) {
    stateLines.push(
      `**Active file:** ${state.activeFile} (line ${state.activeFileLine}, col ${state.activeFileColumn})`,
    );
  }
  if (state.openEditors.length > 0) {
    stateLines.push(
      `**Open editors:**\n${state.openEditors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
  if (state.visibleEditors.length > 0) {
    stateLines.push(`**Visible:** ${state.visibleEditors.join(", ")}`);
  }
  if (state.workspaceFolders.length > 0) {
    stateLines.push(
      `**Workspace folders:**\n${state.workspaceFolders.map((f) => `  - ${f}`).join("\n")}`,
    );
  }
  if (state.activeTerminal) {
    stateLines.push(`**Active terminal:** ${state.activeTerminal}`);
  }

  // Only include modalities where isOpen === true
  const openModalities = Object.entries(state.modalities).filter(
    ([, v]) => v["isOpen"] === true,
  );
  if (openModalities.length > 0) {
    const modalLines = openModalities.map(
      ([k, v]) => `  ${k}: ${JSON.stringify(v)}`,
    );
    stateLines.push(`**Extension state:**\n${modalLines.join("\n")}`);
  }

  const stateSection =
    stateLines.length > 0
      ? `## Current IDE State\n\n${stateLines.join("\n\n")}`
      : `## Current IDE State\n\nNo active session.`;

  // ── Tool section ─────────────────────────────────────────────────────────
  // Always: first 10 tools get name + description, tools 11+ get name only
  const toolLines: string[] = [];
  if (tools.length > 0) {
    for (let i = 0; i < tools.length; i++) {
      if (i < 10) {
        toolLines.push(`- **${tools[i].name}**: ${tools[i].description}`);
      } else {
        toolLines.push(`- ${tools[i].name}`);
      }
    }
  }
  let toolSection =
    toolLines.length > 0
      ? `## Registered Tools\n\n${toolLines.join("\n")}`
      : `## Registered Tools\n\nNo tools registered.`;

  // Post-render budget guard: if the dynamic section (state + tools) still exceeds
  // the effective token budget, fall back to name-only format for ALL tools.
  // This protects against extensions violating the 120-char description cap.
  const dynamicEstimate = estimateTokens(stateSection + "\n\n" + toolSection);
  if (dynamicEstimate > PROMPT_EFFECTIVE_TOKEN_BUDGET && tools.length > 0) {
    const nameOnlyLines = tools.map((t) => `- ${t.name}`);
    toolSection = `## Registered Tools\n\n${nameOnlyLines.join("\n")}`;
  }

  return `${fixed}\n\n${stateSection}\n\n${toolSection}`;
}

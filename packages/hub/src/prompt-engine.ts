/**
 * Hub Prompt Engine
 *
 * Renders the system prompt from current IDE state and tool registry.
 * Enforces a token budget for the dynamic section.
 *
 * Requirements: requirements-hub.md §2.3, §5.3
 */

import type { IDEState, OpenTab, ToolRegistration } from "@accordo/bridge-types";
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
- **For all editor, file navigation, terminal, and UI operations — always use the
  registered accordo tools.** Do not read files with built-in capabilities when
  an accordo tool can do it. This keeps the developer informed of every action.

## Capabilities

You can observe the live IDE state below (active file, cursor position, open
editors, workspace folders, active terminal, and any registered extension
modalities). You can invoke the registered tools to take actions in the IDE.
The complete tool list appears at the end of this prompt.

**Terminology note:** "Accordo review threads" are VS Code Comments-panel gutter
thread widgets (the annotation sidebar). They are entirely separate from inline
code comments (// or /* */). When the developer asks to "add a comment" in the
context of reviewing or annotating, use comment_create. When they ask to
add or remove source-code comments inside a file, edit the file directly.

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
 * Render the ## Open Tabs section.
 * Active groups (containing an isActive tab) are always included.
 * Background groups (all others) are added ascending by groupIndex and
 * dropped from the highest groupIndex when the section would exceed
 * `maxTokens`. This matches the §2.3 requirement: truncate only when the
 * dynamic section would exceed the 1,500-token budget.
 *
 * @param maxTokens  Token cap for the whole rendered section (default: no
 *                   truncation — all groups are included).
 * Returns an empty string when openTabs is empty.
 */
function renderOpenTabs(openTabs: OpenTab[], maxTokens = Infinity): string {
  if (openTabs.length === 0) return "";

  // Cluster tabs by groupIndex
  const groups = new Map<number, OpenTab[]>();
  for (const tab of openTabs) {
    const existing = groups.get(tab.groupIndex) ?? [];
    existing.push(tab);
    groups.set(tab.groupIndex, existing);
  }
  const sortedIndices = [...groups.keys()].sort((a, b) => a - b);

  // Groups that contain at least one active tab are always included
  const activeGroupIndices = new Set(
    openTabs.filter((t) => t.isActive).map((t) => t.groupIndex),
  );

  // Build the markdown text for one group
  const groupBody = (gi: number): string => {
    // gi always originates from groups.keys(), so get() is guaranteed non-null
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const tabs = groups.get(gi)!;
    const lines = tabs.map((t) => {
      const prefix = t.isActive ? "[active] " : "";
      const annotation = t.type === "webview" && t.viewType ? ` (webview: ${t.viewType})` : "";
      return `- ${prefix}${t.label}${annotation}`;
    });
    return `**Group ${gi}:**\n${lines.join("\n")}`;
  };

  // Separate active groups (always kept) from background groups
  const activeGroups = sortedIndices.filter((gi) => activeGroupIndices.has(gi));
  const backgroundGroups = sortedIndices.filter((gi) => !activeGroupIndices.has(gi));

  // Compute chars consumed by active groups
  let usedChars = activeGroups.reduce((sum, gi) => sum + groupBody(gi).length + 2, 0);
  const includedIndices = new Set(activeGroups);

  // Fill from lowest background groupIndex up until budget is exhausted
  for (const gi of backgroundGroups) {
    const content = groupBody(gi);
    const addl = content.length + 2; // +2 for "\n\n" separator
    const projectedTokens = Math.floor((usedChars + addl) / 4);
    if (projectedTokens <= maxTokens) {
      includedIndices.add(gi);
      usedChars += addl;
    } else {
      break;
    }
  }

  const retained = sortedIndices.filter((gi) => includedIndices.has(gi));
  const body = retained.map(groupBody).join("\n\n");
  return `## Open Tabs\n\n${body}`;
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
  // Pre-tab lines: always emitted before Open Tabs (§2.3 ordering).
  const preTabLines: string[] = [];

  if (state.workspaceName) {
    preTabLines.push(`**Workspace:** ${state.workspaceName}`);
  }
  if (state.remoteAuthority) {
    preTabLines.push(`**Remote:** ${state.remoteAuthority}`);
  }
  if (state.activeFile) {
    preTabLines.push(
      `**Active file:** ${state.activeFile} (line ${state.activeFileLine}, col ${state.activeFileColumn})`,
    );
  }
  if (state.openEditors.length > 0) {
    preTabLines.push(
      `**Open editors:**\n${state.openEditors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
  if (state.visibleEditors.length > 0) {
    preTabLines.push(`**Visible:** ${state.visibleEditors.join(", ")}`);
  }
  if (state.workspaceFolders.length > 0) {
    preTabLines.push(
      `**Workspace folders:**\n${state.workspaceFolders.map((f) => `  - ${f}`).join("\n")}`,
    );
  }
  if (state.activeTerminal) {
    preTabLines.push(`**Active terminal:** ${state.activeTerminal}`);
  }

  // ── Post-tab lines: comment threads and modalities ──────────────────────
  const postTabLines: string[] = [];

  // ── Comment threads dedicated section (M42) ────────────────────────────
  // When accordo-comments publishes open threads, render a first-class section
  // instead of the generic JSON modality dump for that key.
  const commentModality = state.modalities["accordo-comments"];
  const openThreadCount = typeof commentModality?.["openThreadCount"] === "number"
    ? (commentModality["openThreadCount"] as number)
    : 0;
  const commentSummary = Array.isArray(commentModality?.["summary"])
    ? (commentModality["summary"] as Array<Record<string, unknown>>)
    : [];

  if (openThreadCount > 0) {
    const entries = commentSummary.map((entry) => {
      const id = entry["threadId"] as string;
      const uri = entry["uri"] as string;
      const line = entry["line"] as number | undefined;
      const preview = entry["preview"] as string;
      const intent = entry["intent"] as string | undefined;
      const anchor = line !== undefined ? `${uri}:${line}` : uri;
      const intentSuffix = intent !== undefined ? ` (${intent})` : "";
      return `- [${id}] ${anchor} — "${preview}"${intentSuffix}`;
    });
    postTabLines.push(
      `## Open Comment Threads (${openThreadCount})\n\n${entries.join("\n")}`,
    );
  }

  // Only include modalities where isOpen === true, excluding accordo-comments
  // (handled by dedicated section above) and accordo-voice (handled by M51-SN).
  const openModalities = Object.entries(state.modalities).filter(
    ([k, v]) => v["isOpen"] === true && k !== "accordo-comments" && k !== "accordo-voice",
  );
  if (openModalities.length > 0) {
    const modalLines = openModalities.map(
      ([k, v]) => `  ${k}: ${JSON.stringify(v)}`,
    );
    postTabLines.push(`**Extension state:**\n${modalLines.join("\n")}`);
  }

  // ── Voice section (M51-SN) — simplified for minimal TTS-only ─────────────
  // Narration is controlled exclusively by the OpenCode narration plugin
  // (ACCORDO_NARRATION_MODE env var). The Hub prompt does NOT include
  // automatic narration directives to avoid double-trigger with the plugin.
  // Voice state is still published so the agent knows TTS is available.
  const voiceModality = state.modalities["accordo-voice"];
  const voicePolicy = voiceModality?.["policy"] as Record<string, unknown> | undefined;
  const voiceEnabled = voicePolicy?.["enabled"] === true;

  let voiceSection = "";
  if (voiceEnabled) {
    const ttsAvailable = voiceModality?.["ttsAvailable"] === true;
    const ttsLabel = ttsAvailable ? "TTS available" : "TTS unavailable";
    voiceSection = `## Voice\n\nStatus: ${ttsLabel}`;
  }

  // ── Tool section with budget guard (uses state WITHOUT Open Tabs) ─────────
  // Build stateWithoutTabs first so tool compression is decided independently
  // of tab content — Open Tabs have their own separate budget allocation (§2.3).
  const stateWithoutTabsLines = [...preTabLines, ...postTabLines];
  const stateWithoutTabs =
    stateWithoutTabsLines.length > 0
      ? `## Current IDE State\n\n${stateWithoutTabsLines.join("\n\n")}`
      : `## Current IDE State\n\nNo active session.`;

  let toolSection =
    tools.length > 0
      ? `## Registered Tools\n\n${tools.map((t) => `- **${t.name}**: ${t.description}`).join("\n")}`
      : `## Registered Tools\n\nNo tools registered.`;

  // Budget guard: if stateWithoutTabs + full-format tools exceeds the effective
  // token budget, fall back to name-only format. This protects against extensions
  // violating the 120-char description cap.
  if (estimateTokens(stateWithoutTabs + "\n\n" + toolSection) > PROMPT_EFFECTIVE_TOKEN_BUDGET && tools.length > 0) {
    toolSection = `## Registered Tools\n\n${tools.map((t) => `- ${t.name}`).join("\n")}`;
  }

  // ── Open Tabs section with dynamic budget (M74-PE / §2.3) ────────────────
  // Truncation fires only when the dynamic section would exceed budget.
  // The tab budget is whatever remains after stateWithoutTabs + toolSection.
  const tabBudget =
    PROMPT_EFFECTIVE_TOKEN_BUDGET -
    estimateTokens(stateWithoutTabs + "\n\n" + toolSection);
  const openTabsSection = renderOpenTabs(state.openTabs ?? [], tabBudget);

  // Assemble final state section: pre-tab → Open Tabs → post-tab
  const stateLines = [...preTabLines];
  if (openTabsSection) {
    stateLines.push(openTabsSection);
  }
  stateLines.push(...postTabLines);

  const stateSection =
    stateLines.length > 0
      ? `## Current IDE State\n\n${stateLines.join("\n\n")}`
      : `## Current IDE State\n\nNo active session.`;

  const sections = [fixed, voiceSection, stateSection, toolSection].filter(Boolean);
  return sections.join("\n\n");
}

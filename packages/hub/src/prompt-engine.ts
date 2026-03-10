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
context of reviewing or annotating, use accordo_comment_create. When they ask to
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

  if (state.workspaceName) {
    stateLines.push(`**Workspace:** ${state.workspaceName}`);
  }
  if (state.remoteAuthority) {
    stateLines.push(`**Remote:** ${state.remoteAuthority}`);
  }
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
    stateLines.push(
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
    stateLines.push(`**Extension state:**\n${modalLines.join("\n")}`);
  }

  const stateSection =
    stateLines.length > 0
      ? `## Current IDE State\n\n${stateLines.join("\n\n")}`
      : `## Current IDE State\n\nNo active session.`;

  // ── Voice section (M51-SN) ───────────────────────────────────────────────
  // Rendered as a top-level section BEFORE the state dump so the narration
  // directive appears early in the prompt and is treated as an instruction,
  // not as informational state data. Models deprioritize late instructions.
  const voiceModality = state.modalities["accordo-voice"];
  const voicePolicy = voiceModality?.["policy"] as Record<string, unknown> | undefined;
  const voiceEnabled = voicePolicy?.["enabled"] === true;

  let voiceSection = "";
  if (voiceEnabled) {
    const session = (voiceModality?.["session"] as string | undefined) ?? "inactive";
    const sttAvailable = voiceModality?.["sttAvailable"] === true;
    const ttsAvailable = voiceModality?.["ttsAvailable"] === true;
    const narrationMode = (voicePolicy?.["narrationMode"] as string | undefined) ?? "narrate-off";
    const speed = (voicePolicy?.["speed"] as number | undefined) ?? 1.0;
    const voice = (voicePolicy?.["voice"] as string | undefined) ?? "";

    const sessionLabel = session.charAt(0).toUpperCase() + session.slice(1);
    const sttLabel = sttAvailable ? "Whisper STT" : "No STT";
    const ttsLabel = ttsAvailable ? "Kokoro TTS" : "No TTS";

    const voiceLines: string[] = [
      `Status: ${sessionLabel} (${sttLabel} + ${ttsLabel})`,
      `Mode: ${narrationMode}, speed ${speed}\u00d7, voice ${voice}`,
    ];

    if (narrationMode === "narrate-summary") {
      voiceLines.push(
        "Directive: After each response, call accordo_voice_readAloud with a 2-3 sentence spoken summary of your answer. Keep it concise and natural for spoken delivery. Do not repeat the full response — summarize the key points.",
      );
      voiceLines.push(
        "If accordo_voice_readAloud returns an error or is unavailable, skip the voice step and proceed with your text response — do not retry.",
      );
    } else if (narrationMode === "narrate-everything") {
      voiceLines.push(
        "Directive: After each response, call accordo_voice_readAloud with your full response text. The text cleaning pipeline will handle markdown/code conversion to spoken form.",
      );
      voiceLines.push(
        "If accordo_voice_readAloud returns an error or is unavailable, skip the voice step and proceed with your text response — do not retry.",
      );
    }

    voiceSection = `## Voice\n\n${voiceLines.join("\n")}`;
  }

  // ── Tool section ─────────────────────────────────────────────────────────
  // Show every registered tool — all are directly callable via MCP.
  //
  // Budget guard: if state + tools exceeds the effective token budget, fall
  // back to name-only format for all tools. With 40 spec-compliant tools
  // (≤120-char descriptions) the budget is not normally exceeded.
  let toolSection =
    tools.length > 0
      ? `## Registered Tools\n\n${tools.map((t) => `- **${t.name}**: ${t.description}`).join("\n")}`
      : `## Registered Tools\n\nNo tools registered.`;

  // Post-render budget guard: if the dynamic section (state + tools) still exceeds
  // the effective token budget, fall back to name-only format for all tools.
  // This protects against extensions violating the 120-char description cap.
  const dynamicEstimate = estimateTokens(stateSection + "\n\n" + toolSection);
  if (dynamicEstimate > PROMPT_EFFECTIVE_TOKEN_BUDGET && tools.length > 0) {
    toolSection = `## Registered Tools\n\n${tools.map((t) => `- ${t.name}`).join("\n")}`;
  }

  const sections = [fixed, voiceSection, stateSection, toolSection].filter(Boolean);
  return sections.join("\n\n");
}

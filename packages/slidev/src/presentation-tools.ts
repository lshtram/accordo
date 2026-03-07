/**
 * accordo-slidev — MCP Tool Definitions
 *
 * Creates and returns the 9 presentation tool definitions registered
 * with the Bridge via BridgeAPI.registerTools().
 *
 * All tool handler dependencies are injected via PresentationToolDeps
 * so the tool layer is unit-testable without VS Code.
 *
 * Source: requirements-slidev.md §3 (M44-TL-01 through M44-TL-09)
 *
 * Requirements:
 *   M44-TL-01  discover exists, ungrouped (prompt-visible), lists available deck files
 *   M44-TL-02  open opens a deck URI, returns error if file missing / invalid
 *   M44-TL-03  close ends session, kills process, disposes webview, resets state
 *   M44-TL-04  listSlides returns ordered slide metadata
 *   M44-TL-05  getCurrent returns current slide index + title
 *   M44-TL-06  goto moves to exact slide index
 *   M44-TL-07  next advances one slide
 *   M44-TL-08  prev goes back one slide
 *   M44-TL-09  generateNarration returns narration text for a slide (or all)
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { SlideSummary, SlideNarration } from "./types.js";

// ── Tool Dependency Interface ─────────────────────────────────────────────────

/**
 * All external dependencies for presentation tool handlers.
 * Injected so tools are testable without VS Code.
 */
export interface PresentationToolDeps {
  /**
   * M44-TL-01 / M44-TST-01
   * Returns workspace-relative paths to all .md files findable in the workspace.
   */
  discoverDeckFiles(): Promise<string[]>;

  /**
   * M44-TL-02
   * Opens a deck session. Returns `{}` on success, or `{ error }` on failure.
   */
  openSession(deckUri: string): Promise<{ error?: string }>;

  /**
   * M44-TL-03
   * Closes the current session. No-op if nothing is open.
   */
  closeSession(): void;

  /**
   * M44-TL-04
   */
  listSlides(): Promise<SlideSummary[] | { error: string }>;

  /**
   * M44-TL-05
   */
  getCurrent(): Promise<{ index: number; title: string } | { error: string }>;

  /**
   * M44-TL-06
   */
  goto(index: number): Promise<{ error?: string }>;

  /**
   * M44-TL-07
   */
  next(): Promise<{ error?: string }>;

  /**
   * M44-TL-08
   */
  prev(): Promise<{ error?: string }>;

  /**
   * M44-TL-09
   */
  generateNarration(
    target: number | "all",
  ): Promise<SlideNarration[] | { error: string }>;
}

// ── Tool factory ──────────────────────────────────────────────────────────────

/**
 * M44-TL-01 through M44-TL-09
 * Creates the nine presentation tool definitions.
 *
 * - discover: ungrouped (prompt-visible), safe
 * - open/close: group "presentation", moderate danger
 * - all others: group "presentation", safe
 */
export function createPresentationTools(
  deps: PresentationToolDeps,
): ExtensionToolDefinition[] {
  return [
    // ── M44-TL-01: discover ──────────────────────────────────────────────────
    {
      name: "accordo_presentation_discover",
      description:
        "List all Slidev deck files (.md with Slidev frontmatter or deck naming conventions) found in the workspace. Use this before opening a presentation to find available deck paths.",
      dangerLevel: "safe",
      // ungrouped — prompt-visible so agents can discover decks without prior context
      inputSchema: { type: "object", properties: {}, required: [] },
      handler: async (_args) => {
        const decks = await deps.discoverDeckFiles();
        return { decks };
      },
    },

    // ── M44-TL-02: open ──────────────────────────────────────────────────────
    {
      name: "accordo_presentation_open",
      description: "Open a Slidev deck and start a presentation session.",
      dangerLevel: "moderate",
      group: "presentation",
      inputSchema: {
        type: "object",
        properties: {
          deckUri: { type: "string", description: "Absolute path to the .md deck file." },
        },
        required: ["deckUri"],
      },
      handler: async (args) => {
        const deckUri = args["deckUri"];
        if (typeof deckUri !== "string" || !deckUri) {
          return { error: "deckUri is required and must be a string." };
        }
        return deps.openSession(deckUri);
      },
    },

    // ── M44-TL-03: close ─────────────────────────────────────────────────────
    {
      name: "accordo_presentation_close",
      description: "Close the active presentation session and kill the Slidev process.",
      dangerLevel: "moderate",
      group: "presentation",
      inputSchema: { type: "object", properties: {}, required: [] },
      handler: async (_args) => {
        deps.closeSession();
        return {};
      },
    },

    // ── M44-TL-04: listSlides ────────────────────────────────────────────────
    {
      name: "accordo_presentation_listSlides",
      description: "List all slides in the current deck with metadata.",
      dangerLevel: "safe",
      group: "presentation",
      inputSchema: { type: "object", properties: {}, required: [] },
      handler: async (_args) => {
        const result = await deps.listSlides();
        if ("error" in result) return result;
        return { slides: result };
      },
    },

    // ── M44-TL-05: getCurrent ────────────────────────────────────────────────
    {
      name: "accordo_presentation_getCurrent",
      description: "Return the current slide index and title.",
      dangerLevel: "safe",
      group: "presentation",
      inputSchema: { type: "object", properties: {}, required: [] },
      handler: async (_args) => {
        const result = await deps.getCurrent();
        return result;
      },
    },

    // ── M44-TL-06: goto ──────────────────────────────────────────────────────
    {
      name: "accordo_presentation_goto",
      description: "Navigate to a specific slide by index (0-based).",
      dangerLevel: "safe",
      group: "presentation",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "0-based slide index to navigate to." },
        },
        required: ["index"],
      },
      handler: async (args) => {
        const index = args["index"];
        if (typeof index !== "number") {
          return { error: "index is required and must be a number." };
        }
        return deps.goto(index);
      },
    },

    // ── M44-TL-07: next ──────────────────────────────────────────────────────
    {
      name: "accordo_presentation_next",
      description: "Advance to the next slide.",
      dangerLevel: "safe",
      group: "presentation",
      inputSchema: { type: "object", properties: {}, required: [] },
      handler: async (_args) => deps.next(),
    },

    // ── M44-TL-08: prev ──────────────────────────────────────────────────────
    {
      name: "accordo_presentation_prev",
      description: "Go back to the previous slide.",
      dangerLevel: "safe",
      group: "presentation",
      inputSchema: { type: "object", properties: {}, required: [] },
      handler: async (_args) => deps.prev(),
    },

    // ── M44-TL-09: generateNarration ─────────────────────────────────────────
    {
      name: "accordo_presentation_generateNarration",
      description: "Generate narration text for a slide or all slides.",
      dangerLevel: "safe",
      group: "presentation",
      inputSchema: {
        type: "object",
        properties: {
          slideIndex: {
            type: "number",
            description: "0-based slide index. Omit to generate for all slides.",
          },
        },
        required: [],
      },
      handler: async (args) => {
        const target: number | "all" =
          typeof args["slideIndex"] === "number" ? args["slideIndex"] : "all";
        const result = await deps.generateNarration(target);
        if ("error" in result) return result;
        return { narrations: result };
      },
    },
  ];
}

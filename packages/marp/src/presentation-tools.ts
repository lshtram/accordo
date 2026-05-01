/**
 * accordo-marp — MCP Tool Definitions
 *
 * Source: requirements-marp.md §3 (M50-TL-01 through M50-TL-09)
 */

import type { ExtensionToolDefinition } from "@accordo/bridge-types";
import type { SlideSummary, SlideNarration } from "./types.js";

export interface PresentationToolDeps {
  discoverDeckFiles(): Promise<string[]>;
  openSession(deckUri: string): Promise<{ error?: string }>;
  closeSession(): void;
  listSlides(): Promise<SlideSummary[] | { error: string }>;
  getCurrent(): Promise<{ index: number; title: string } | { error: string }>;
  goto(index: number): Promise<{ error?: string }>;
  next(): Promise<{ error?: string }>;
  prev(): Promise<{ error?: string }>;
  generateNarration(
    target: number | "all",
  ): Promise<SlideNarration[] | { error: string }>;
}

export function createPresentationTools(
  deps: PresentationToolDeps,
): ExtensionToolDefinition[] {
  return [
    {
      name: "accordo_presentation_open",
      description: "Open a Marp deck and start a presentation session. Read accordo://skills/presentation for Marp workflow guidance.",
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
        const result = await deps.openSession(deckUri);
        if (result.error) return result;
        return { opened: true, deckUri };
      },
    },

    {
      name: "accordo_presentation_close",
      description: "Close the active presentation session. Read accordo://skills/presentation for Marp workflow guidance.",
      dangerLevel: "moderate",
      group: "presentation",
      inputSchema: { type: "object", properties: {}, required: [] },
      handler: async (_args) => {
        deps.closeSession();
        return {};
      },
    },

    {
      name: "accordo_presentation_getCurrent",
      description: "Return the current slide number (1-based) and title. Read accordo://skills/presentation for Marp workflow guidance.",
      dangerLevel: "safe",
      group: "presentation",
      inputSchema: { type: "object", properties: {}, required: [] },
      handler: async (_args) => {
        const result = await deps.getCurrent();
        if ("error" in result) return result;
        // Convert 0-based internal index to 1-based for the agent
        return { ...result, index: result.index + 1 };
      },
    },

    {
      name: "accordo_presentation_goto",
      description: "Navigate to a specific slide by 1-based slide number (slide 1 is the first slide). Read accordo://skills/presentation for Marp workflow guidance.",
      dangerLevel: "safe",
      group: "presentation",
      inputSchema: {
        type: "object",
        properties: {
          index: { type: "number", description: "1-based slide number to navigate to (slide 1 is the first slide)." },
        },
        required: ["index"],
      },
      handler: async (args) => {
        const index = args["index"];
        if (typeof index !== "number") {
          return { error: "index is required and must be a number." };
        }
        // Convert 1-based input to 0-based internal index
        return deps.goto(index - 1);
      },
    },

    {
      name: "accordo_presentation_generateNarration",
      description: "Generate narration text for a slide or all slides. Read accordo://skills/presentation and accordo://skills/walkthrough for narration workflows.",
      dangerLevel: "safe",
      group: "presentation",
      inputSchema: {
        type: "object",
        properties: {
          slideIndex: {
            type: "number",
            description: "1-based slide number. Omit to generate for all slides.",
          },
        },
        required: [],
      },
      handler: async (args) => {
        // Convert 1-based slideIndex to 0-based before passing to adapter
        const target: number | "all" =
          typeof args["slideIndex"] === "number" ? args["slideIndex"] - 1 : "all";
        const result = await deps.generateNarration(target);
        if ("error" in result) return result;
        return {
          narrations: result.map((narration) => ({
            ...narration,
            slideIndex: narration.slideIndex + 1,
          })),
        };
      },
    },

  ];
}

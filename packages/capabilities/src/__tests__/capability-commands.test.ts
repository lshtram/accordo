/**
 * @accordo/capabilities — CapabilityCommandMap coverage test
 *
 * Verifies that CapabilityCommandMap contains exactly the stable command keys
 * (set equality: all stable keys present, no extra keys).
 *
 * Source: Phase A §3.1 rule + §6 deliverable (capability-commands.test.ts)
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const CAPABILITIES_SRC = resolve(__dirname, "../index.ts");

// ─── Helpers (duplicated from capabilities-foundation.test.ts for self-containment)

function extractCapabilityCommandMapBlock(source: string): string {
  const marker = "export interface CapabilityCommandMap {";
  const startIdx = source.indexOf(marker);
  if (startIdx === -1) throw new Error("CapabilityCommandMap not found");

  let depth = 0;
  let endIdx = startIdx;
  for (let i = startIdx; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  return source.slice(startIdx, endIdx + 1);
}

function extractMapKeys(mapBlock: string): string[] {
  const keys: string[] = [];
  const regex = /\[CAPABILITY_COMMANDS\.([A-Z_]+)\]/g;
  let match;
  while ((match = regex.exec(mapBlock)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

// Stable commands per Phase A §3.1
const STABLE_COMMANDS = [
  "COMMENTS_GET_STORE",
  "COMMENTS_GET_THREADS_FOR_URI",
  "COMMENTS_CREATE_SURFACE_COMMENT",
  "COMMENTS_RESOLVE_THREAD",
  "COMMENTS_GET_SURFACE_ADAPTER",
  "COMMENTS_EXPAND_THREAD",
  "PREVIEW_FOCUS_THREAD",
  "DIAGRAM_FOCUS_THREAD",
] as const;

// Deferred commands per Phase A §3.2 (must NOT appear in map)
const DEFERRED_COMMANDS = [
  "PRESENTATION_GOTO",
  "PRESENTATION_FOCUS_THREAD",
  "BROWSER_FOCUS_THREAD",
] as const;

describe("CapabilityCommandMap coverage", () => {
  it("covers all 8 stable commands", () => {
    const source = readFileSync(CAPABILITIES_SRC, "utf-8");
    const mapBlock = extractCapabilityCommandMapBlock(source);
    const mapKeys = extractMapKeys(mapBlock);

    for (const cmd of STABLE_COMMANDS) {
      expect(
        mapKeys,
        `CapabilityCommandMap must contain ${cmd}`
      ).toContain(cmd);
    }
  });

  it("contains only stable commands (no deferred commands)", () => {
    const source = readFileSync(CAPABILITIES_SRC, "utf-8");
    const mapBlock = extractCapabilityCommandMapBlock(source);
    const mapKeys = extractMapKeys(mapBlock);

    for (const cmd of DEFERRED_COMMANDS) {
      expect(
        mapKeys,
        `CapabilityCommandMap must NOT contain ${cmd} (deferred)`
      ).not.toContain(cmd);
    }
  });

  it("has exactly 8 entries", () => {
    const source = readFileSync(CAPABILITIES_SRC, "utf-8");
    const mapBlock = extractCapabilityCommandMapBlock(source);
    const mapKeys = extractMapKeys(mapBlock);
    expect(mapKeys).toHaveLength(8);
  });
});

/**
 * @accordo/capabilities — Phase B failing tests
 *
 * Phase A design source: docs/30-development/capabilities-foundation-phase-a.md
 *
 * Requirement traceability:
 * - REQ-1 (§3.1 rule):  Stable commands in CAPABILITY_COMMANDS with correct canonical string values
 * - REQ-2 (§3.2 rule):  Deferred commands are NOT in CAPABILITY_COMMANDS
 * - REQ-3 (§3.2 table): DEFERRED_COMMANDS exists with correct canonical string values
 * - REQ-4 (§3.1 rule):  CapabilityCommandMap has exactly the 8 stable command keys (set equality)
 * - REQ-5 (§3.1 table): Stable interfaces exported with correct method signatures
 * - REQ-6 (§3.2 rule):  Deferred interfaces NOT exported from package root
 * - REQ-7 (§3.2 table): deferred.ts exists and exports deferred interfaces
 * - REQ-8/G8 (§3.3 + §5 G8): Package is runtime-free (no vscode, exact allowed deps)
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

// ─── Phase A constants ─────────────────────────────────────────────────────────
// Source: Phase A §3.1 (stable) and §3.2 (deferred) + §2 table for values

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

const DEFERRED_COMMANDS = [
  "PRESENTATION_GOTO",
  "PRESENTATION_FOCUS_THREAD",
  "BROWSER_FOCUS_THREAD",
] as const;

const STABLE_INTERFACES = [
  "SurfaceCommentAdapter",
  "CommentStoreAdapter",
  "CommentsCapability",
  "PreviewCapability",
  "DiagramCapability",
] as const;

const DEFERRED_INTERFACES = ["PresentationCapability", "BrowserCapability"] as const;

// Expected string values for stable commands (Phase A §2 table)
const STABLE_COMMAND_VALUES: Record<(typeof STABLE_COMMANDS)[number], string> = {
  COMMENTS_GET_STORE: "accordo_comments_internal_getStore",
  COMMENTS_GET_THREADS_FOR_URI: "accordo_comments_internal_getThreadsForUri",
  COMMENTS_CREATE_SURFACE_COMMENT: "accordo_comments_internal_createSurfaceComment",
  COMMENTS_RESOLVE_THREAD: "accordo_comments_internal_resolveThread",
  COMMENTS_GET_SURFACE_ADAPTER: "accordo_comments_internal_getSurfaceAdapter",
  COMMENTS_EXPAND_THREAD: "accordo_comments_internal_expandThread",
  PREVIEW_FOCUS_THREAD: "accordo_preview_internal_focusThread",
  DIAGRAM_FOCUS_THREAD: "accordo_diagram_focusThread",
};

// Expected string values for deferred commands (Phase A §2 table)
const DEFERRED_COMMAND_VALUES: Record<(typeof DEFERRED_COMMANDS)[number], string> = {
  PRESENTATION_GOTO: "accordo_presentation_internal_goto",
  PRESENTATION_FOCUS_THREAD: "accordo_presentation_internal_focusThread",
  BROWSER_FOCUS_THREAD: "accordo_browser_focusThread",
};

// Expected methods per stable interface (Phase A §3.1 table)
const STABLE_INTERFACE_METHODS: Record<(typeof STABLE_INTERFACES)[number], string[]> = {
  SurfaceCommentAdapter: ["createThread", "reply", "resolve", "reopen", "delete", "getThreadsForUri", "onChanged"],
  CommentStoreAdapter: ["createThread", "reply", "resolve", "reopen", "delete", "getThreadsForUri", "onChanged"],
  CommentsCapability: ["getStore", "getThreadsForUri", "createSurfaceComment", "resolveThread", "getSurfaceAdapter", "expandThread"],
  PreviewCapability: ["focusThread"],
  DiagramCapability: ["focusThread"],
};

// Phase A §3.1 table — exact signature expectations per method.
// Each entry: { paramCount, returnType (checked via .includes()) }
// For paramCount: exact number of top-level parameters.
// For returnType: the actual source return type string must contain this substring
//   (allowing TypeScript sugar variations like T[] vs Array<T>).
type SigExpect = { paramCount: number; returnType: string };
const STABLE_INTERFACE_SIGNATURES: Record<
  string, // iface
  Record<string, SigExpect>
> = {
  CommentsCapability: {
    getStore: {
      paramCount: 0,
      returnType: "Promise<CommentStoreAdapter>",
    },
    getThreadsForUri: {
      paramCount: 1,
      returnType: "Promise<CommentThread[]>",
    },
    createSurfaceComment: {
      paramCount: 1,
      returnType: "Promise<{ threadId: string; commentId: string }>",
    },
    resolveThread: {
      paramCount: 1,
      returnType: "Promise<void>",
    },
    getSurfaceAdapter: {
      paramCount: 0,
      returnType: "Promise<SurfaceCommentAdapter>",
    },
    expandThread: {
      paramCount: 1,
      returnType: "Promise<boolean>",
    },
  },
  PreviewCapability: {
    focusThread: {
      paramCount: 3, // uri, threadId, blockId (all at top level)
      returnType: "Promise<boolean>",
    },
  },
  DiagramCapability: {
    focusThread: {
      paramCount: 2, // threadId, mmdUri (mmdUri is optional)
      returnType: "Promise<void>",
    },
  },
  SurfaceCommentAdapter: {
    createThread: {
      paramCount: 1,
      returnType: "Promise<CommentThread>",
    },
    reply: {
      paramCount: 1,
      returnType: "Promise<void>",
    },
    resolve: {
      paramCount: 1,
      returnType: "Promise<void>",
    },
    reopen: {
      paramCount: 1,
      returnType: "Promise<void>",
    },
    delete: {
      paramCount: 1,
      returnType: "Promise<void>",
    },
    getThreadsForUri: {
      paramCount: 1,
      returnType: "CommentThread[]",
    },
    onChanged: {
      paramCount: 1,
      returnType: "{ dispose(): void }",
    },
  },
  CommentStoreAdapter: {
    createThread: {
      paramCount: 1,
      returnType: "Promise<CommentThread>",
    },
    reply: {
      paramCount: 1,
      returnType: "Promise<void>",
    },
    resolve: {
      paramCount: 1,
      returnType: "Promise<void>",
    },
    reopen: {
      paramCount: 1,
      returnType: "Promise<void>",
    },
    delete: {
      paramCount: 1,
      returnType: "Promise<void>",
    },
    getThreadsForUri: {
      paramCount: 1,
      returnType: "CommentThread[]",
    },
    onChanged: {
      paramCount: 1,
      returnType: "{ dispose(): void }",
    },
  },
};

// ─── File paths ───────────────────────────────────────────────────────────────

const CAPABILITIES_SRC = resolve(__dirname, "../index.ts");
const DEFERRED_FILE = resolve(__dirname, "../deferred.ts");
const PACKAGE_JSON = resolve(__dirname, "../../package.json");

// ─── Helper: extract CapabilityCommandMap block using brace counting ─────────────

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

// Helper: extract all [CAPABILITY_COMMANDS.X] keys from a CapabilityCommandMap block
function extractMapKeys(mapBlock: string): string[] {
  const keys: string[] = [];
  const regex = /\[CAPABILITY_COMMANDS\.([A-Z_]+)\]/g;
  let match;
  while ((match = regex.exec(mapBlock)) !== null) {
    keys.push(match[1]);
  }
  return keys;
}

// Helper: extract all keys and their string values from a const block
function extractConstEntries(source: string, constName: string): Array<{ key: string; value: string }> {
  const regex = new RegExp(`export const ${constName} = \\{([^}]+)\\} as const;`, "s");
  const match = source.match(regex);
  if (!match) return [];
  const block = match[1];
  const entries: Array<{ key: string; value: string }> = [];
  const entryRegex = /^  ([A-Z_]+):\s*["']([^"']+)["']/gm;
  let entryMatch;
  while ((entryMatch = entryRegex.exec(block)) !== null) {
    entries.push({ key: entryMatch[1], value: entryMatch[2] });
  }
  return entries;
}

// Helper: strip // line comments and /* block comments */ from a string
function stripComments(text: string): string {
  // Remove block comments (including nested ones — approximated by non-greedy)
  let result = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments
  result = result.replace(/\/\/.*$/gm, "");
  return result;
}

// Helper: extract method names from an interface definition.
// Strategy: isolate the interface body, strip all comments, then find
// word+paren patterns at brace-depth 0 that are not property type annotations.
function extractInterfaceMethods(source: string, ifaceName: string): string[] {
  // Find the interface definition start
  const ifaceStart = source.indexOf(`export interface ${ifaceName}`);
  if (ifaceStart === -1) return [];

  // Find the opening brace of the interface
  const braceStart = source.indexOf("{", ifaceStart);
  if (braceStart === -1) return [];

  // Track brace depth to find matching closing brace
  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }

  // Extract and strip comments from the interface body
  const body = source.slice(braceStart + 1, i);
  const cleanBody = stripComments(body);
  const methods: string[] = [];

  // Match method names at depth 0: optional readonly, word, open paren.
  // The skip list covers TypeScript keywords and common type names that appear
  // in return type positions (e.g. Promise, Array, CommentStoreAdapter).
  const skipSet = new Set([
    "string", "number", "boolean", "void", "any", "never", "unknown",
    "object", "symbol", "bigint", "undefined", "null",
    "Promise", "Array", "Record", "Partial", "Required", "Readonly",
    "Pick", "Omit", "Exclude", "Extract", "NonNullable",
    "ReturnType", "Parameters", "InstanceType",
    "Error", "Options", "Config", "Result", "Response", "Request",
    "Event", "Handler", "Callback", "Listener", "Observer",
    "Consumer", "Provider", "Factory", "Builder",
    "Manager", "Service", "Controller", "Processor",
    "Parser", "Serializer", "Deserializer",
    "Encoder", "Decoder", "Validator", "Normalizer",
    "Transformer", "Converter", "Mapper",
    "Resolver", "Collector", "Accumulator",
  ]);

  const methodRegex = /(?:readonly\s+)?(\w+)\s*\(/g;
  let match;

  while ((match = methodRegex.exec(cleanBody)) !== null) {
    const matchPos = match.index;
    const beforeMatch = cleanBody.slice(0, matchPos);

    // Only count if at brace depth 0 (not inside a nested object/function type)
    const openBraces = (beforeMatch.match(/\{/g) || []).length;
    const closeBraces = (beforeMatch.match(/\}/g) || []).length;
    if (openBraces - closeBraces !== 0) continue;

    // Skip if preceded by ":" or "=" (property type annotation, not a method)
    const wordStart = matchPos + match[0].indexOf(match[1]);
    const charBefore = wordStart > 0 ? beforeMatch[beforeMatch.length - 1] : "";
    if (charBefore === ":" || charBefore === "=") continue;

    const methodName = match[1];
    if (skipSet.has(methodName)) continue;

    methods.push(methodName);
  }

  return methods;
}

// Helper: count top-level parameters in a params string (split on comma outside nested parens/braces)
function countParams(params: string): number {
  if (!params.trim()) return 0;
  let depth = 0;
  let count = 0;
  for (const ch of params) {
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) count++;
  }
  return count + 1;
}

// Helper: extract all method signatures from an interface body.
// Handles nested parens in params and nested braces in return types (e.g. Promise<{...}>).
// Returns a map of method name -> { params, returnType }.
function extractAllSignatures(
  cleanBody: string
): Record<string, { params: string; returnType: string }> {
  const results: Record<string, { params: string; returnType: string }> = {};

  // Pattern: methodName( ... ) : ReturnType ;
  // We need to:
  // 1. Match methodName(
  // 2. Find matching ) for the params (accounting for nested parens)
  // 3. Match :
  // 4. Find the returnType (which may contain nested braces — e.g. { threadId: string })
  // 5. Stop at the first ;
  // Strategy: scan through cleanBody with a state machine.
  let pos = 0;
  while (pos < cleanBody.length) {
    // Skip whitespace
    while (pos < cleanBody.length && /\s/.test(cleanBody[pos])) pos++;
    if (pos >= cleanBody.length) break;

    // Check for optional readonly
    let isReadonly = false;
    if (cleanBody.slice(pos, pos + 9) === "readonly ") {
      isReadonly = true;
      pos += 9;
      while (pos < cleanBody.length && /\s/.test(cleanBody[pos])) pos++;
    }

    // Must start with an identifier (method name)
    const identMatch = cleanBody.slice(pos).match(/^[a-zA-Z_$][\w$]*/);
    if (!identMatch) { pos++; continue; }
    const methodName = identMatch[0];
    pos += methodName.length;

    // Skip whitespace before (
    while (pos < cleanBody.length && /\s/.test(cleanBody[pos])) pos++;
    if (cleanBody[pos] !== "(") { pos++; continue; }

    // Find matching ) for params (track brace/parens depth inside params)
    pos++; // skip '('
    let paramDepth = 1;
    let paramStart = pos;
    while (pos < cleanBody.length && paramDepth > 0) {
      if (cleanBody[pos] === "(" || cleanBody[pos] === "{" || cleanBody[pos] === "[") paramDepth++;
      else if (cleanBody[pos] === ")" || cleanBody[pos] === "}" || cleanBody[pos] === "]") paramDepth--;
      pos++;
    }
    const params = cleanBody.slice(paramStart, pos - 1); // exclude the ')'

    // Skip whitespace before :
    while (pos < cleanBody.length && /\s/.test(cleanBody[pos])) pos++;
    if (cleanBody[pos] !== ":") { pos++; continue; }
    pos++; // skip ':'

    // Skip whitespace before return type
    while (pos < cleanBody.length && /\s/.test(cleanBody[pos])) pos++;

    // Find return type — may contain nested braces, so count brace depth
    let retStart = pos;
    let braceDepth = 0;
    while (pos < cleanBody.length) {
      const ch = cleanBody[pos];
      if (ch === "{") braceDepth++;
      else if (ch === "}") {
        braceDepth--;
        if (braceDepth < 0) break; // unbalanced, shouldn't happen
        if (braceDepth === 0) {
          // We found the closing } of a return type like Promise<{...}> or { dispose(): void }.
          // After pos++, the next char is either '>' (for generics) or ';' (for plain types).
          // We continue the loop so the next iteration handles '>' or ';' normally.
          pos++;
          continue;
        }
      } else if (ch === ";" && braceDepth === 0) {
        break;
      }
      pos++;
    }
    const returnType = cleanBody.slice(retStart, pos).trim();

    if (methodName && !results[methodName]) {
      results[methodName] = { params, returnType };
    }
  }

  return results;
}

// Helper: check if an interface definition exists as an actual export (not comment)
function hasActualExport(source: string, pattern: string): boolean {
  // Match "export interface X" at start of line (not in comment)
  const lines = source.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === pattern || trimmed.startsWith(pattern + " ") || trimmed.startsWith(pattern + "<")) {
      return true;
    }
  }
  return false;
}

// ─── REQ-1: Stable commands in CAPABILITY_COMMANDS with correct values ────────
/**
 * Source: Phase A §3.1 rule "Must exist in CAPABILITY_COMMANDS"
 * Each stable command must be a key with its canonical string value from §2.
 */
describe("CAPABILITIES-REQ-1: Stable commands in CAPABILITY_COMMANDS", () => {
  for (const cmd of STABLE_COMMANDS) {
    it(`RE1-${cmd}: ${cmd} has correct canonical string value`, () => {
      const source = readFileSync(CAPABILITIES_SRC, "utf-8");
      const entries = extractConstEntries(source, "CAPABILITY_COMMANDS");
      const entry = entries.find((e) => e.key === cmd);
      expect(entry, `${cmd} must be a key in CAPABILITY_COMMANDS`).toBeDefined();
      expect(entry!.value, `${cmd} must have canonical value`).toBe(STABLE_COMMAND_VALUES[cmd]);
    });
  }

  it("RE1-COUNT: CAPABILITY_COMMANDS has exactly 8 stable keys", () => {
    const source = readFileSync(CAPABILITIES_SRC, "utf-8");
    const entries = extractConstEntries(source, "CAPABILITY_COMMANDS");
    expect(entries).toHaveLength(8);
  });
});

// ─── REQ-2: Deferred commands NOT in CAPABILITY_COMMANDS ─────────────────────
/**
 * Source: Phase A §3.2 rule "Must live in DEFERRED_COMMANDS, not CAPABILITY_COMMANDS"
 */
describe("CAPABILITIES-REQ-2: Deferred commands NOT in CAPABILITY_COMMANDS", () => {
  for (const cmd of DEFERRED_COMMANDS) {
    it(`RE2-${cmd}: ${cmd} is NOT in CAPABILITY_COMMANDS`, () => {
      const source = readFileSync(CAPABILITIES_SRC, "utf-8");
      const entries = extractConstEntries(source, "CAPABILITY_COMMANDS");
      const found = entries.find((e) => e.key === cmd);
      expect(
        found,
        `${cmd} must not be in CAPABILITY_COMMANDS — it belongs in DEFERRED_COMMANDS`
      ).toBeUndefined();
    });
  }
});

// ─── REQ-3: DEFERRED_COMMANDS exists with correct values ─────────────────────
/**
 * Source: Phase A §3.2 table + §6 deliverable
 */
describe("CAPABILITIES-REQ-3: DEFERRED_COMMANDS exists with correct values", () => {
  it("RE3-EXISTS: DEFERRED_COMMANDS export exists", () => {
    const source = readFileSync(CAPABILITIES_SRC, "utf-8");
    expect(source).toContain("export const DEFERRED_COMMANDS");
  });

  for (const cmd of DEFERRED_COMMANDS) {
    it(`RE3-${cmd}-KEY: ${cmd} is a key in DEFERRED_COMMANDS`, () => {
      const source = readFileSync(CAPABILITIES_SRC, "utf-8");
      const entries = extractConstEntries(source, "DEFERRED_COMMANDS");
      const entry = entries.find((e) => e.key === cmd);
      expect(entry, `${cmd} must be in DEFERRED_COMMANDS`).toBeDefined();
    });

    it(`RE3-${cmd}-VALUE: ${cmd} has correct canonical string value`, () => {
      const source = readFileSync(CAPABILITIES_SRC, "utf-8");
      const entries = extractConstEntries(source, "DEFERRED_COMMANDS");
      const entry = entries.find((e) => e.key === cmd);
      expect(entry, `${cmd} must be in DEFERRED_COMMANDS`).toBeDefined();
      expect(entry!.value, `${cmd} must have canonical value`).toBe(DEFERRED_COMMAND_VALUES[cmd]);
    });
  }
});

// ─── REQ-4: CapabilityCommandMap has exact stable command set ──────────────────
/**
 * Source: Phase A §3.1 rule "Must cover all stable command IDs, and only stable command IDs"
 * Set equality: hasAll(stable) AND hasOnly(stable).
 */
describe("CAPABILITIES-REQ-4: CapabilityCommandMap exact stable command set", () => {
  it("RE4-ALL: CapabilityCommandMap contains all 8 stable commands", () => {
    const source = readFileSync(CAPABILITIES_SRC, "utf-8");
    const mapBlock = extractCapabilityCommandMapBlock(source);
    const mapKeys = extractMapKeys(mapBlock);

    for (const cmd of STABLE_COMMANDS) {
      expect(mapKeys, `CapabilityCommandMap must contain ${cmd}`).toContain(cmd);
    }
  });

  it("RE4-ONLY: CapabilityCommandMap contains only stable commands", () => {
    const source = readFileSync(CAPABILITIES_SRC, "utf-8");
    const mapBlock = extractCapabilityCommandMapBlock(source);
    const mapKeys = extractMapKeys(mapBlock);

    for (const cmd of DEFERRED_COMMANDS) {
      expect(mapKeys, `CapabilityCommandMap must NOT contain ${cmd}`).not.toContain(cmd);
    }
  });

  it("RE4-SIZE: CapabilityCommandMap has exactly 8 keys", () => {
    const source = readFileSync(CAPABILITIES_SRC, "utf-8");
    const mapBlock = extractCapabilityCommandMapBlock(source);
    const mapKeys = extractMapKeys(mapBlock);
    expect(mapKeys).toHaveLength(8);
  });
});

// ─── REQ-5: Stable interfaces with correct method signatures ────────────────────
/**
 * Source: Phase A §3.1 table
 * Each stable interface must be exported AND have the correct method signatures.
 * RE5-* tests verify method name presence.
 * RE5-SIG-* tests verify parameter count and return type substring.
 */
describe("CAPABILITIES-REQ-5: Stable interfaces with correct signatures", () => {
  for (const iface of STABLE_INTERFACES) {
    it(`RE5-${iface}-EXPORT: ${iface} is exported from index.ts`, () => {
      const source = readFileSync(CAPABILITIES_SRC, "utf-8");
      expect(hasActualExport(source, `export interface ${iface}`)).toBe(true);
    });

    it(`RE5-${iface}-METHODS: ${iface} has correct method signatures`, () => {
      const source = readFileSync(CAPABILITIES_SRC, "utf-8");
      const methods = extractInterfaceMethods(source, iface);
      const expectedMethods = STABLE_INTERFACE_METHODS[iface];
      expect(
        methods,
        `${iface} must have methods: ${expectedMethods.join(", ")}`
      ).toEqual(expectedMethods);
    });
  }

  // Signature sub-tests: parameter count + return type for each method
  for (const iface of STABLE_INTERFACES) {
    const sigs = STABLE_INTERFACE_SIGNATURES[iface];
    if (!sigs) continue;
    const methodNames = Object.keys(sigs);

    for (const methodName of methodNames) {
      const expected = sigs[methodName]!;

      it(`RE5-SIG-${iface}-${methodName}: ${iface}.${methodName}() has correct signature`, () => {
        const source = readFileSync(CAPABILITIES_SRC, "utf-8");

        // Extract the interface body
        const ifaceStart = source.indexOf(`export interface ${iface}`);
        if (ifaceStart === -1) throw new Error(`${iface} not found`);
        const braceStart = source.indexOf("{", ifaceStart);
        let depth = 0, i = braceStart;
        for (; i < source.length; i++) {
          if (source[i] === "{") depth++;
          else if (source[i] === "}") { depth--; if (depth === 0) break; }
        }
        const body = source.slice(braceStart + 1, i);
        const cleanBody = stripComments(body);
        const sigs = extractAllSignatures(cleanBody);
        const sig = sigs[methodName];

        expect(
          sig,
          `${iface}.${methodName}() must exist in source`
        ).toBeDefined();

        // Check parameter count
        const actualParamCount = countParams(sig!.params);
        expect(
          actualParamCount,
          `${iface}.${methodName}() must have ${expected.paramCount} param(s), got ${actualParamCount}`
        ).toBe(expected.paramCount);

        // Check return type contains the expected substring
        expect(
          sig!.returnType,
          `${iface}.${methodName}() return type must include "${expected.returnType}"`
        ).toContain(expected.returnType);
      });
    }
  }
});

// ─── REQ-6: Deferred interfaces NOT exported from package root ─────────────────
/**
 * Source: Phase A §3.2 rule
 * Deferred interfaces must NOT appear as exports in index.ts.
 */
describe("CAPABILITIES-REQ-6: Deferred interfaces NOT exported from package root", () => {
  for (const iface of DEFERRED_INTERFACES) {
    it(`RE6-${iface}: ${iface} is NOT exported from index.ts`, () => {
      const source = readFileSync(CAPABILITIES_SRC, "utf-8");
      expect(
        hasActualExport(source, `export interface ${iface}`),
        `${iface} must NOT be exported from index.ts — it belongs in deferred.ts`
      ).toBe(false);
    });
  }
});

// ─── REQ-7: deferred.ts exists and exports deferred interfaces ─────────────────
/**
 * Source: Phase A §3.2 table + §6 deliverable
 */
describe("CAPABILITIES-REQ-7: deferred.ts exports deferred interfaces", () => {
  it("RE7-FILE: deferred.ts exists", () => {
    expect(existsSync(DEFERRED_FILE)).toBe(true);
  });

  for (const iface of DEFERRED_INTERFACES) {
    it(`RE7-${iface}: ${iface} is exported from deferred.ts`, () => {
      expect(existsSync(DEFERRED_FILE)).toBe(true);
      const source = readFileSync(DEFERRED_FILE, "utf-8");
      expect(
        hasActualExport(source, `export interface ${iface}`),
        `${iface} must be exported from deferred.ts`
      ).toBe(true);
    });
  }
});

// ─── REQ-8/G8: Package is runtime-free ───────────────────────────────────────
/**
 * Source: Phase A §3.3 + §5 Gate G8
 * Package must have no runtime dependencies except @accordo/bridge-types.
 * All .ts source files under src/ are checked for forbidden imports.
 */
describe("CAPABILITIES-REQ-8/G8: Package is runtime-free", () => {
  const SRC_DIR = resolve(__dirname, "..");

  // Collect all .ts files under src/ (non-recursive, src/ is flat)
  const tsFiles: string[] = (() => {
    try {
      return readdirSync(SRC_DIR)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => resolve(SRC_DIR, f));
    } catch {
      return [];
    }
  })();

  for (const filePath of tsFiles) {
    const fileName = filePath.split("/").pop()!;
    it(`RE8-VSCODE-IMPORT-${fileName}: ${fileName} does not import vscode`, () => {
      const source = readFileSync(filePath, "utf-8");
      expect(
        source,
        `${fileName} must not import vscode`
      ).not.toMatch(/from\s+['"]vscode['"]/);
    });
  }

  it("RE8-VSCODE-PKG: package.json does not list vscode", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.peerDependencies };
    expect(deps).not.toHaveProperty("vscode");
  });

  it("G8-EXACT-DEPS: package.json has exactly @accordo/bridge-types as runtime dep", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8"));
    const deps = pkg.dependencies ?? {};
    const depNames = Object.keys(deps);

    // The ONLY allowed runtime dependency is @accordo/bridge-types
    expect(
      depNames,
      `Only @accordo/bridge-types allowed as runtime dep, found: ${depNames.join(", ")}`
    ).toEqual(["@accordo/bridge-types"]);
  });

  it("G8-NO-VSCODE-TYPES: package.json has no @types/vscode", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps).not.toHaveProperty("@types/vscode");
  });
});

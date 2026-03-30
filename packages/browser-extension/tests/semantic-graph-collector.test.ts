/**
 * semantic-graph-collector.test.ts
 *
 * Tests for M113-SEM — Semantic Graph Collector
 *
 * Tests validate:
 * - B2-SG-001: Unified semantic graph response — all four sub-trees in one call
 * - B2-SG-002: Accessibility tree snapshot — SemanticA11yNode array with role/name/nodeId/children
 * - B2-SG-003: Landmark extraction — Landmark array with role/label/nodeId/tag
 * - B2-SG-004: Document outline — OutlineHeading array with level/text/nodeId/id
 * - B2-SG-005: Form model extraction — FormModel array with field details
 * - B2-SG-006: Per-call nodeId scoping — same DOM element = same nodeId across sub-trees
 * - B2-SG-007: SnapshotEnvelope compliance — pageId/frameId/snapshotId/capturedAt/viewport/source
 * - B2-SG-008: maxDepth parameter — limits a11y tree nesting depth
 * - B2-SG-009: visibleOnly parameter — filters hidden elements
 * - B2-SG-010: Performance budget — completes within 15000 ms
 * - B2-SG-013: Password redaction — exact "[REDACTED]"
 * - B2-SG-015: Empty sub-trees — always arrays, never undefined
 *
 * API checklist (collectSemanticGraph):
 * - B2-SG-001: Returns SemanticGraphResult with a11yTree, landmarks, outline, forms
 * - B2-SG-002: a11yTree is SemanticA11yNode[], nodes have role/name/nodeId/children
 * - B2-SG-003: landmarks is Landmark[], each has role/nodeId/tag, label when aria-label present
 * - B2-SG-004: outline is OutlineHeading[], each has level/text/nodeId, id when present; in document order
 * - B2-SG-005: forms is FormModel[], fields have tag/type/name/label/required/value/nodeId
 * - B2-SG-006: nodeIds are non-negative integers, same DOM element = same nodeId across sub-trees
 * - B2-SG-007: Result extends SnapshotEnvelope — pageId/frameId/snapshotId/capturedAt/viewport/source
 * - B2-SG-008: maxDepth limits a11y tree depth (default 8, max 16)
 * - B2-SG-009: visibleOnly excludes hidden elements (default true); false includes all elements
 * - B2-SG-010: Performance budget 15000 ms
 * - B2-SG-013: password field values are exactly "[REDACTED]"
 * - B2-SG-015: all four sub-tree fields always present, never undefined
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  collectSemanticGraph,
  DEFAULT_MAX_DEPTH,
  MAX_DEPTH_LIMIT,
  SEMANTIC_GRAPH_TIMEOUT_MS,
} from "../src/content/semantic-graph-collector.js";
import type {
  SemanticA11yNode,
  Landmark,
  OutlineHeading,
  FormModel,
  FormField,
  SemanticGraphResult,
} from "../src/content/semantic-graph-collector.js";

// ── Test Helper ────────────────────────────────────────────────────────────────

/**
 * Wraps the synchronous collectSemanticGraph call in a Promise so it can be
 * awaited. Errors (including "not implemented" stubs) surface to the caller
 * rather than being swallowed — Phase B tests must fail at the assertion level,
 * not from null/property-access crashes.
 */
async function collectGraph(
  options?: Parameters<typeof collectSemanticGraph>[0]
): Promise<SemanticGraphResult> {
  return Promise.resolve()
    .then(() => collectSemanticGraph(options))
    .catch((e) => {
      throw e;
    });
}

// ── DOM Setup ─────────────────────────────────────────────────────────────────

/**
 * Sets up a comprehensive test page with:
 * - Landmark elements: header>nav, main, aside, footer
 * - Headings: h1 (with id), h2 (with id), h3
 * - A form with: text input (required), password input, email input, submit button
 * - Buttons with aria-label
 * - role="navigation" with aria-label
 * - Hidden elements: display:none, visibility:hidden
 */
function setupTestDOM(): void {
  document.title = "M113-SEM Test Page";

  document.body.innerHTML = `
    <header id="site-header">
      <nav id="primary-nav" aria-label="Primary nav">
        <ul>
          <li><a href="/">Home</a></li>
        </ul>
      </nav>
    </header>

    <main id="main-content">
      <h1 id="page-title">Welcome to the Site</h1>
      <article id="article-1">
        <h2 id="section-1">Section One</h2>
        <p>This is a paragraph inside an article.</p>
        <h3 id="subsection-1a">Subsection One A</h3>
        <p>Another paragraph here.</p>
      </article>
      <form id="login-form" action="/login" method="POST">
        <div>
          <label for="username">Username</label>
          <input type="text" id="username" name="username" required>
        </div>
        <div>
          <label for="password">Password</label>
          <input type="password" id="password" name="password">
        </div>
        <div>
          <label for="email">Email Address</label>
          <input type="email" id="email" name="email">
        </div>
        <button type="submit" id="submit-btn">Sign In</button>
      </form>
    </main>

    <aside id="sidebar">
      <h2 id="sidebar-heading">Related Content</h2>
      <p>Some sidebar content.</p>
    </aside>

    <footer id="site-footer">
      <p>&copy; 2026 Example Corp</p>
    </footer>

    <div id="hidden-element" style="display:none;">Should not appear</div>
    <div id="visibility-hidden" style="visibility:hidden;">Also hidden</div>

    <button id="close-btn" aria-label="Close dialog" role="button">X</button>

    <nav id="secondary-nav" aria-label="Secondary nav">
      <ul>
        <li><a href="/about">About</a></li>
      </ul>
    </nav>
  `;
}

// Mock getBoundingClientRect keyed by element id
function mockGetBoundingClientRect(this: HTMLElement): DOMRect {
  const id = this.id;
  const rects: Record<string, DOMRect> = {
    "site-header": { x: 0, y: 0, width: 1280, height: 60, top: 0, right: 1280, bottom: 60, left: 0 } as DOMRect,
    "primary-nav": { x: 0, y: 0, width: 1280, height: 40, top: 0, right: 1280, bottom: 40, left: 0 } as DOMRect,
    "main-content": { x: 0, y: 60, width: 900, height: 600, top: 60, right: 900, bottom: 660, left: 0 } as DOMRect,
    "page-title": { x: 10, y: 70, width: 880, height: 50, top: 70, right: 890, bottom: 120, left: 10 } as DOMRect,
    "article-1": { x: 10, y: 130, width: 880, height: 300, top: 130, right: 890, bottom: 430, left: 10 } as DOMRect,
    "section-1": { x: 10, y: 140, width: 860, height: 40, top: 140, right: 870, bottom: 180, left: 10 } as DOMRect,
    "subsection-1a": { x: 10, y: 190, width: 860, height: 35, top: 190, right: 870, bottom: 225, left: 10 } as DOMRect,
    "login-form": { x: 10, y: 240, width: 400, height: 200, top: 240, right: 410, bottom: 440, left: 10 } as DOMRect,
    "username": { x: 10, y: 250, width: 200, height: 30, top: 250, right: 210, bottom: 280, left: 10 } as DOMRect,
    "password": { x: 10, y: 290, width: 200, height: 30, top: 290, right: 210, bottom: 320, left: 10 } as DOMRect,
    "email": { x: 10, y: 330, width: 200, height: 30, top: 330, right: 210, bottom: 360, left: 10 } as DOMRect,
    "submit-btn": { x: 10, y: 370, width: 100, height: 40, top: 370, right: 110, bottom: 410, left: 10 } as DOMRect,
    "sidebar": { x: 910, y: 60, width: 370, height: 600, top: 60, right: 1280, bottom: 660, left: 910 } as DOMRect,
    "sidebar-heading": { x: 920, y: 70, width: 350, height: 40, top: 70, right: 1270, bottom: 110, left: 920 } as DOMRect,
    "site-footer": { x: 0, y: 660, width: 1280, height: 60, top: 660, right: 1280, bottom: 720, left: 0 } as DOMRect,
    "hidden-element": { x: 0, y: 800, width: 200, height: 40, top: 800, right: 200, bottom: 840, left: 0 } as DOMRect,
    "visibility-hidden": { x: 0, y: 850, width: 200, height: 40, top: 850, right: 200, bottom: 890, left: 0 } as DOMRect,
    "close-btn": { x: 1200, y: 10, width: 60, height: 40, top: 10, right: 1260, bottom: 50, left: 1200 } as DOMRect,
    "secondary-nav": { x: 0, y: 660, width: 1280, height: 40, top: 660, right: 1280, bottom: 700, left: 0 } as DOMRect,
  };
  return rects[id ?? ""] ?? { x: 100, y: 100, width: 200, height: 40, top: 100, right: 300, bottom: 140, left: 100 } as DOMRect;
}

beforeEach(() => {
  setupTestDOM();
  vi.stubGlobal("getBoundingClientRect", mockGetBoundingClientRect);
  Object.defineProperty(window, "innerWidth", { value: 1280, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
});

afterEach(() => {
  document.title = "";
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

// ── B2-SG-001: Unified Semantic Graph Response ───────────────────────────────

describe("B2-SG-001: Unified semantic graph response", () => {
  it("B2-SG-001: Result contains all four sub-trees", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    expect(result).toHaveProperty("a11yTree");
    expect(result).toHaveProperty("landmarks");
    expect(result).toHaveProperty("outline");
    expect(result).toHaveProperty("forms");
  });

  it("B2-SG-001: All four sub-trees are arrays", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    expect(Array.isArray(result!.a11yTree)).toBe(true);
    expect(Array.isArray(result!.landmarks)).toBe(true);
    expect(Array.isArray(result!.outline)).toBe(true);
    expect(Array.isArray(result!.forms)).toBe(true);
  });

  it("B2-SG-001: Single relay round-trip produces all four sub-trees", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    // All four arrays should be populated (or empty) — never undefined
    expect("a11yTree" in result!).toBe(true);
    expect("landmarks" in result!).toBe(true);
    expect("outline" in result!).toBe(true);
    expect("forms" in result!).toBe(true);
  });
});

// ── B2-SG-002: Accessibility Tree Snapshot ──────────────────────────────────

describe("B2-SG-002: Accessibility tree snapshot", () => {
  it("B2-SG-002: a11yTree is an array of SemanticA11yNode", async () => {
    const result = await collectGraph();
    expect(result?.a11yTree).toBeDefined();
    expect(Array.isArray(result!.a11yTree)).toBe(true);
  });

  it("B2-SG-002: Each node has role as non-empty string", async () => {
    const result = await collectGraph();
    expect(result?.a11yTree).toBeDefined();
    for (const node of result!.a11yTree) {
      expect(typeof node.role).toBe("string");
      expect(node.role.length).toBeGreaterThan(0);
    }
  });

  it("B2-SG-002: Each node has name as string or undefined", async () => {
    const result = await collectGraph();
    expect(result?.a11yTree).toBeDefined();
    for (const node of result!.a11yTree) {
      if (node.name !== undefined) {
        expect(typeof node.name).toBe("string");
      }
    }
  });

  it("B2-SG-002: Each node has non-negative integer nodeId", async () => {
    const result = await collectGraph();
    expect(result?.a11yTree).toBeDefined();
    for (const node of result!.a11yTree) {
      expect(typeof node.nodeId).toBe("number");
      expect(node.nodeId).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(node.nodeId)).toBe(true);
    }
  });

  it("B2-SG-002: Each node has children as array", async () => {
    const result = await collectGraph();
    expect(result?.a11yTree).toBeDefined();
    for (const node of result!.a11yTree) {
      expect(Array.isArray(node.children)).toBe(true);
    }
  });

  it("B2-SG-002: Node with role='button' has correct name from aria-label", async () => {
    const result = await collectGraph();
    expect(result?.a11yTree).toBeDefined();
    // Find button with aria-label="Close dialog"
    const buttonNode = result!.a11yTree.find(
      (n) => n.role === "button" && n.name === "Close dialog"
    );
    expect(buttonNode).toBeDefined();
    expect(buttonNode!.role).toBe("button");
    expect(buttonNode!.name).toBe("Close dialog");
  });

  it("B2-SG-002: Heading nodes have level property (1-6)", async () => {
    const result = await collectGraph();
    expect(result?.a11yTree).toBeDefined();
    const headingNodes = result!.a11yTree.filter((n) => n.role === "heading");
    for (const h of headingNodes) {
      expect(h.level).toBeDefined();
      expect(h.level).toBeGreaterThanOrEqual(1);
      expect(h.level).toBeLessThanOrEqual(6);
    }
  });

  it("B2-SG-002: Tree depth is bounded by maxDepth", async () => {
    const result = await collectGraph({ maxDepth: 1 });
    expect(result?.a11yTree).toBeDefined();
    // With maxDepth 1, root nodes have no grandchildren
    const checkDepth = (nodes: SemanticA11yNode[], depth: number): boolean => {
      if (depth > 1 && nodes.length > 0) return false;
      for (const node of nodes) {
        if (!checkDepth(node.children, depth + 1)) return false;
      }
      return true;
    };
    expect(checkDepth(result!.a11yTree, 1)).toBe(true);
  });

  it("B2-SG-002: maxDepth: 2 allows one level of children", async () => {
    const result = await collectGraph({ maxDepth: 2 });
    expect(result?.a11yTree).toBeDefined();
    // With maxDepth 2, depth 2 should have empty children arrays
    const checkDepth2 = (nodes: SemanticA11yNode[], depth: number): boolean => {
      if (depth > 2 && nodes.length > 0) return false;
      for (const node of nodes) {
        if (!checkDepth2(node.children, depth + 1)) return false;
      }
      return true;
    };
    expect(checkDepth2(result!.a11yTree, 1)).toBe(true);
  });

  it("B2-SG-002: Nodes without accessible role are excluded", async () => {
    const result = await collectGraph();
    expect(result?.a11yTree).toBeDefined();
    // All nodes should have a meaningful role
    for (const node of result!.a11yTree) {
      expect(node.role.length).toBeGreaterThan(0);
    }
  });
});

// ── B2-SG-003: Landmark Extraction ───────────────────────────────────────────

describe("B2-SG-003: Landmark extraction", () => {
  it("B2-SG-003: landmarks includes header landmark", async () => {
    const result = await collectGraph();
    expect(result?.landmarks).toBeDefined();
    const roles = result!.landmarks.map((l) => l.role);
    expect(roles).toContain("banner");
  });

  it("B2-SG-003: landmarks includes nav landmark", async () => {
    const result = await collectGraph();
    expect(result?.landmarks).toBeDefined();
    const roles = result!.landmarks.map((l) => l.role);
    expect(roles).toContain("navigation");
  });

  it("B2-SG-003: landmarks includes main landmark", async () => {
    const result = await collectGraph();
    expect(result?.landmarks).toBeDefined();
    const roles = result!.landmarks.map((l) => l.role);
    expect(roles).toContain("main");
  });

  it("B2-SG-003: landmarks includes complementary (aside) landmark", async () => {
    const result = await collectGraph();
    expect(result?.landmarks).toBeDefined();
    const roles = result!.landmarks.map((l) => l.role);
    expect(roles).toContain("complementary");
  });

  it("B2-SG-003: landmarks includes contentinfo (footer) landmark", async () => {
    const result = await collectGraph();
    expect(result?.landmarks).toBeDefined();
    const roles = result!.landmarks.map((l) => l.role);
    expect(roles).toContain("contentinfo");
  });

  it("B2-SG-003: Each landmark has role and nodeId", async () => {
    const result = await collectGraph();
    expect(result?.landmarks).toBeDefined();
    for (const landmark of result!.landmarks) {
      expect(typeof landmark.role).toBe("string");
      expect(landmark.role.length).toBeGreaterThan(0);
      expect(typeof landmark.nodeId).toBe("number");
      expect(landmark.nodeId).toBeGreaterThanOrEqual(0);
    }
  });

  it("B2-SG-003: Each landmark has tag property", async () => {
    const result = await collectGraph();
    expect(result?.landmarks).toBeDefined();
    for (const landmark of result!.landmarks) {
      expect(typeof landmark.tag).toBe("string");
      expect(landmark.tag.length).toBeGreaterThan(0);
    }
  });

  it("B2-SG-003: Landmark with aria-label has label property set", async () => {
    const result = await collectGraph();
    expect(result?.landmarks).toBeDefined();
    // Find nav with aria-label="Primary nav"
    const primaryNav = result!.landmarks.find(
      (l) => l.role === "navigation" && l.label === "Primary nav"
    );
    expect(primaryNav).toBeDefined();
    expect(primaryNav!.label).toBe("Primary nav");
  });

  it("B2-SG-003: Secondary nav landmark has its own aria-label", async () => {
    const result = await collectGraph();
    expect(result?.landmarks).toBeDefined();
    const secondaryNav = result!.landmarks.find(
      (l) => l.role === "navigation" && l.label === "Secondary nav"
    );
    expect(secondaryNav).toBeDefined();
  });

  it("B2-SG-003: role='navigation' appears for explicit role attribute", async () => {
    const result = await collectGraph();
    expect(result?.landmarks).toBeDefined();
    const navLandmarks = result!.landmarks.filter((l) => l.role === "navigation");
    expect(navLandmarks.length).toBeGreaterThanOrEqual(2); // primary-nav + secondary-nav
  });
});

// ── B2-SG-004: Document Outline ──────────────────────────────────────────────

describe("B2-SG-004: Document outline", () => {
  it("B2-SG-004: outline is array of OutlineHeading", async () => {
    const result = await collectGraph();
    expect(result?.outline).toBeDefined();
    expect(Array.isArray(result!.outline)).toBe(true);
  });

  it("B2-SG-004: Each heading has level 1-6", async () => {
    const result = await collectGraph();
    expect(result?.outline).toBeDefined();
    for (const heading of result!.outline) {
      expect(typeof heading.level).toBe("number");
      expect(heading.level).toBeGreaterThanOrEqual(1);
      expect(heading.level).toBeLessThanOrEqual(6);
    }
  });

  it("B2-SG-004: Each heading has non-empty text string", async () => {
    const result = await collectGraph();
    expect(result?.outline).toBeDefined();
    for (const heading of result!.outline) {
      expect(typeof heading.text).toBe("string");
      expect(heading.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("B2-SG-004: Each heading has non-negative integer nodeId", async () => {
    const result = await collectGraph();
    expect(result?.outline).toBeDefined();
    for (const heading of result!.outline) {
      expect(typeof heading.nodeId).toBe("number");
      expect(heading.nodeId).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(heading.nodeId)).toBe(true);
    }
  });

  it("B2-SG-004: Outline headings appear in document order with correct levels", async () => {
    const result = await collectGraph();
    expect(result?.outline).toBeDefined();
    // Test DOM order: h1 "Welcome to the Site", h2 "Section One", h3 "Subsection One A", h2 "Related Content"
    expect(result!.outline[0].level).toBe(1); // h1 first
    expect(result!.outline[0].text).toContain("Welcome");
    expect(result!.outline[1].level).toBe(2); // h2 "Section One" second
    expect(result!.outline[1].text).toContain("Section One");
    expect(result!.outline[2].level).toBe(3); // h3 "Subsection One A" third
    expect(result!.outline[2].text).toContain("Subsection");
    expect(result!.outline[3].level).toBe(2); // h2 "Related Content" fourth
    expect(result!.outline[3].text).toContain("Related Content");
  });

  it("B2-SG-004: h1 with id='page-title' has id='page-title' in outline entry", async () => {
    const result = await collectGraph();
    expect(result?.outline).toBeDefined();
    const h1 = result!.outline.find((h) => h.id === "page-title");
    expect(h1).toBeDefined();
    expect(h1!.level).toBe(1);
    expect(h1!.text).toContain("Welcome");
  });

  it("B2-SG-004: h2 with id='section-1' appears in outline", async () => {
    const result = await collectGraph();
    expect(result?.outline).toBeDefined();
    const h2 = result!.outline.find((h) => h.id === "section-1");
    expect(h2).toBeDefined();
    expect(h2!.level).toBe(2);
    expect(h2!.text).toContain("Section One");
  });

  it("B2-SG-004: Heading with id has id field present", async () => {
    const result = await collectGraph();
    expect(result?.outline).toBeDefined();
    const headingWithId = result!.outline.find((h) => h.id !== undefined);
    if (headingWithId) {
      expect(headingWithId.id).toBeDefined();
    }
  });

  it("B2-SG-004: No non-heading elements in outline", async () => {
    const result = await collectGraph();
    expect(result?.outline).toBeDefined();
    for (const heading of result!.outline) {
      expect(heading.level).toBeGreaterThanOrEqual(1);
      expect(heading.level).toBeLessThanOrEqual(6);
    }
  });
});

// ── B2-SG-005: Form Model Extraction ────────────────────────────────────────

describe("B2-SG-005: Form model extraction", () => {
  it("B2-SG-005: forms is an array of FormModel", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    expect(Array.isArray(result!.forms)).toBe(true);
  });

  it("B2-SG-005: First form has fields array", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    expect(result!.forms.length).toBeGreaterThan(0);
    expect(Array.isArray(result!.forms[0].fields)).toBe(true);
  });

  it("B2-SG-005: username field is required: true", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    const usernameField = result!.forms[0].fields.find((f) => f.name === "username");
    expect(usernameField).toBeDefined();
    expect(usernameField!.required).toBe(true);
  });

  it("B2-SG-005: password field has value redacted as exactly '[REDACTED]'", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    const passwordField = result!.forms[0].fields.find((f) => f.name === "password");
    expect(passwordField).toBeDefined();
    // Per B2-SG-013: password value must be exactly "[REDACTED]"
    expect(passwordField!.value).toBe("[REDACTED]");
  });

  it("B2-SG-005: email field is not required by default", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    const emailField = result!.forms[0].fields.find((f) => f.name === "email");
    expect(emailField).toBeDefined();
    expect(emailField!.required).toBe(false);
  });

  it("B2-SG-005: Each field has associated label text", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    for (const field of result!.forms[0].fields) {
      // Each field should have a label
      expect(field.label).toBeDefined();
      if (field.label !== undefined) {
        expect(field.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("B2-SG-005: Each field has tag property", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    for (const field of result!.forms[0].fields) {
      expect(typeof field.tag).toBe("string");
      expect(field.tag.length).toBeGreaterThan(0);
    }
  });

  it("B2-SG-005: Each field has type property when applicable", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    for (const field of result!.forms[0].fields) {
      if (field.tag === "input") {
        expect(typeof field.type).toBe("string");
      }
    }
  });

  it("B2-SG-005: Each field has non-negative integer nodeId", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    for (const field of result!.forms[0].fields) {
      expect(typeof field.nodeId).toBe("number");
      expect(field.nodeId).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(field.nodeId)).toBe(true);
    }
  });

  it("B2-SG-005: Submit button has type='submit'", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    const submitField = result!.forms[0].fields.find((f) => f.type === "submit");
    expect(submitField).toBeDefined();
  });

  it("B2-SG-005: Form has action URL", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    expect(result!.forms[0].action).toBeDefined();
  });

  it("B2-SG-005: Form has method GET or POST", async () => {
    const result = await collectGraph();
    expect(result?.forms).toBeDefined();
    expect(["GET", "POST"]).toContain(result!.forms[0].method);
  });
});

// ── B2-SG-006: Per-call NodeId Scoping ──────────────────────────────────────

describe("B2-SG-006: Per-call nodeId scoping", () => {
  it("B2-SG-006: All nodeIds across all sub-trees are non-negative integers", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();

    const allNodeIds: number[] = [];

    for (const node of result!.a11yTree) {
      collectNodeIds(node, allNodeIds);
    }
    for (const landmark of result!.landmarks) {
      allNodeIds.push(landmark.nodeId);
    }
    for (const heading of result!.outline) {
      allNodeIds.push(heading.nodeId);
    }
    for (const form of result!.forms) {
      allNodeIds.push(form.nodeId);
      for (const field of form.fields) {
        allNodeIds.push(field.nodeId);
      }
    }

    for (const id of allNodeIds) {
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(id)).toBe(true);
    }
  });

  it("B2-SG-006: nodeIds are unique within each sub-tree (a11y, landmarks, outline, forms separately)", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();

    // Check a11yTree uniqueness (recursive)
    const a11yIds: number[] = [];
    for (const node of result!.a11yTree) {
      collectNodeIds(node, a11yIds);
    }
    expect(new Set(a11yIds).size).toBe(a11yIds.length);

    // Check landmarks uniqueness
    const landmarkIds = result!.landmarks.map((l) => l.nodeId);
    expect(new Set(landmarkIds).size).toBe(landmarkIds.length);

    // Check outline uniqueness
    const outlineIds = result!.outline.map((h) => h.nodeId);
    expect(new Set(outlineIds).size).toBe(outlineIds.length);

    // Check forms/fields uniqueness
    const formFieldIds: number[] = [];
    for (const form of result!.forms) {
      formFieldIds.push(form.nodeId);
      for (const field of form.fields) {
        formFieldIds.push(field.nodeId);
      }
    }
    expect(new Set(formFieldIds).size).toBe(formFieldIds.length);
  });

  it("B2-SG-006: Same DOM element in multiple sub-trees has same nodeId", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();

    // Find h1 in outline
    const h1Outline = result!.outline.find((h) => h.id === "page-title");
    expect(h1Outline).toBeDefined();

    // h1 should also appear in a11yTree — find it and compare nodeId
    const h1InA11y = findInA11yTree(result!.a11yTree, "heading");
    if (h1InA11y) {
      expect(h1InA11y.nodeId).toBe(h1Outline!.nodeId);
    }
  });
});

function collectNodeIds(node: SemanticA11yNode, ids: number[]): void {
  ids.push(node.nodeId);
  for (const child of node.children) {
    collectNodeIds(child, ids);
  }
}

function findInA11yTree(nodes: SemanticA11yNode[], role: string): SemanticA11yNode | undefined {
  for (const node of nodes) {
    if (node.role === role) return node;
    const found = findInA11yTree(node.children, role);
    if (found) return found;
  }
  return undefined;
}

// ── B2-SG-007: SnapshotEnvelope Compliance ───────────────────────────────────

describe("B2-SG-007: SnapshotEnvelope compliance", () => {
  it("B2-SG-007: Result has pageId", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    expect(result).toHaveProperty("pageId");
    expect(typeof result!.pageId).toBe("string");
    expect(result!.pageId.length).toBeGreaterThan(0);
  });

  it("B2-SG-007: Result has frameId", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    expect(result).toHaveProperty("frameId");
    expect(typeof result!.frameId).toBe("string");
  });

  it("B2-SG-007: Result has snapshotId in {pageId}:{version} format", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    expect(result).toHaveProperty("snapshotId");
    expect(result!.snapshotId).toMatch(/^[^:]+:\d+$/);
  });

  it("B2-SG-007: Result has capturedAt in ISO 8601 format", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    expect(result).toHaveProperty("capturedAt");
    expect(result!.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("B2-SG-007: Result has viewport with width/height/scrollX/scrollY/devicePixelRatio", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    expect(result!.viewport).toHaveProperty("width");
    expect(result!.viewport).toHaveProperty("height");
    expect(result!.viewport).toHaveProperty("scrollX");
    expect(result!.viewport).toHaveProperty("scrollY");
    expect(result!.viewport).toHaveProperty("devicePixelRatio");
  });

  it("B2-SG-007: Result has source='dom'", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    expect(result!.source).toBe("dom");
  });

  it("B2-SG-007: Result has pageUrl and title", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    expect(result).toHaveProperty("pageUrl");
    expect(result).toHaveProperty("title");
    expect(typeof result!.pageUrl).toBe("string");
    expect(typeof result!.title).toBe("string");
  });
});

// ── B2-SG-008: maxDepth Parameter ───────────────────────────────────────────

describe("B2-SG-008: maxDepth parameter", () => {
  it("B2-SG-008: Default maxDepth is 8", () => {
    expect(DEFAULT_MAX_DEPTH).toBe(8);
  });

  it("B2-SG-008: MAX_DEPTH_LIMIT is 16", () => {
    expect(MAX_DEPTH_LIMIT).toBe(16);
  });

  it("B2-SG-008: maxDepth: 1 returns a11y nodes with no grandchildren", async () => {
    const result = await collectGraph({ maxDepth: 1 });
    expect(result).toBeDefined();
    // At depth 1, root nodes (depth 0) have children at depth 1
    // But those children (depth 1) should have empty children arrays
    const allHaveEmptyChildren = (nodes: SemanticA11yNode[], depth: number): boolean => {
      if (depth >= 1) {
        for (const node of nodes) {
          if (node.children.length > 0) return false;
        }
      }
      for (const node of nodes) {
        if (!allHaveEmptyChildren(node.children, depth + 1)) return false;
      }
      return true;
    };
    expect(allHaveEmptyChildren(result!.a11yTree, 0)).toBe(true);
  });

  it("B2-SG-008: maxDepth: 2 allows one level of children", async () => {
    const result = await collectGraph({ maxDepth: 2 });
    expect(result).toBeDefined();
    // At depth 2, depth 2 nodes should have empty children, depth 1 can have children
    const checkDepth2 = (nodes: SemanticA11yNode[], depth: number): boolean => {
      if (depth >= 2) {
        for (const node of nodes) {
          if (node.children.length > 0) return false;
        }
      }
      for (const node of nodes) {
        if (!checkDepth2(node.children, depth + 1)) return false;
      }
      return true;
    };
    expect(checkDepth2(result!.a11yTree, 0)).toBe(true);
  });

  it("B2-SG-008: maxDepth does not affect landmarks, outline, or forms", async () => {
    const resultDefault = await collectGraph({ maxDepth: DEFAULT_MAX_DEPTH });
    const resultDepth1 = await collectGraph({ maxDepth: 1 });
    expect(resultDefault).toBeDefined();
    expect(resultDepth1).toBeDefined();
    // landmarks, outline, and forms should be identical regardless of maxDepth
    expect(resultDepth1!.landmarks.length).toBe(resultDefault!.landmarks.length);
    expect(resultDepth1!.outline.length).toBe(resultDefault!.outline.length);
    expect(resultDepth1!.forms.length).toBe(resultDefault!.forms.length);
  });
});

// ── B2-SG-009: visibleOnly Parameter ─────────────────────────────────────────

describe("B2-SG-009: visibleOnly parameter", () => {
  it("B2-SG-009: visibleOnly: true (default) excludes display:none elements", async () => {
    const result = await collectGraph({ visibleOnly: true });
    expect(result).toBeDefined();
    // Hidden element should not appear in any sub-tree
    const hiddenInA11y = findTextInA11y(result!.a11yTree, "Should not appear");
    expect(hiddenInA11y).toBeUndefined();
  });

  it("B2-SG-009: visibleOnly: true excludes visibility:hidden elements", async () => {
    const result = await collectGraph({ visibleOnly: true });
    expect(result).toBeDefined();
    const hiddenInA11y = findTextInA11y(result!.a11yTree, "Also hidden");
    expect(hiddenInA11y).toBeUndefined();
  });

  it("B2-SG-009: visibleOnly: false includes hidden elements (count greater than visibleOnly: true)", async () => {
    const resultVisibleOnly = await collectGraph({ visibleOnly: true });
    const resultIncludeAll = await collectGraph({ visibleOnly: false });
    expect(resultVisibleOnly).toBeDefined();
    expect(resultIncludeAll).toBeDefined();
    // Count all nodes in visibleOnly: true result
    const countVisible = countAllNodes(resultVisibleOnly!);
    // Count all nodes in visibleOnly: false result
    const countIncludeAll = countAllNodes(resultIncludeAll!);
    // visibleOnly: false should include MORE nodes (hidden elements included)
    expect(countIncludeAll).toBeGreaterThan(countVisible);
  });

  it("B2-SG-009: Default visibleOnly is true", async () => {
    // Call without visibleOnly - should behave like visibleOnly: true
    const resultExplicit = await collectGraph({ visibleOnly: true });
    const resultDefault = await collectGraph();
    expect(resultExplicit).toBeDefined();
    expect(resultDefault).toBeDefined();
    // Both should produce the same landmarks count (hidden elements don't appear in landmarks anyway)
    expect(resultExplicit!.landmarks.length).toBe(resultDefault!.landmarks.length);
  });

  it("B2-SG-009: visibleOnly: true excludes hidden landmarks (display:none)", async () => {
    // Add a hidden nav element — should not appear in landmarks when visibleOnly: true
    document.body.innerHTML += `<nav id="hidden-nav" style="display:none;" aria-label="Hidden nav">hidden</nav>`;
    const resultVisible = await collectGraph({ visibleOnly: true });
    const resultAll = await collectGraph({ visibleOnly: false });
    expect(resultVisible).toBeDefined();
    expect(resultAll).toBeDefined();
    // The hidden nav must not appear in the visible-only landmark list
    const hiddenNavVisible = resultVisible!.landmarks.find((l) => l.tag === "nav" && l.label === "Hidden nav");
    expect(hiddenNavVisible).toBeUndefined();
    // But it should appear when visibleOnly: false
    const hiddenNavAll = resultAll!.landmarks.find((l) => l.tag === "nav" && l.label === "Hidden nav");
    expect(hiddenNavAll).toBeDefined();
  });

  it("B2-SG-009: visibleOnly: true excludes hidden headings from outline", async () => {
    // Add a hidden heading — should not appear in outline when visibleOnly: true
    document.body.innerHTML += `<h2 id="hidden-heading" style="display:none;">Hidden Heading</h2>`;
    const resultVisible = await collectGraph({ visibleOnly: true });
    const resultAll = await collectGraph({ visibleOnly: false });
    expect(resultVisible).toBeDefined();
    expect(resultAll).toBeDefined();
    // The hidden heading must not appear in the outline when visibleOnly: true
    const hiddenOutlineVisible = resultVisible!.outline.find((h) => h.text === "Hidden Heading");
    expect(hiddenOutlineVisible).toBeUndefined();
    // But it should appear when visibleOnly: false
    const hiddenOutlineAll = resultAll!.outline.find((h) => h.text === "Hidden Heading");
    expect(hiddenOutlineAll).toBeDefined();
  });

  it("B2-SG-009: visibleOnly: true excludes hidden forms", async () => {
    // Add a hidden form — should not appear in forms when visibleOnly: true
    document.body.innerHTML += `<form id="hidden-form" style="display:none;"><input type="text" id="hf-field" name="hf-field"></form>`;
    const resultVisible = await collectGraph({ visibleOnly: true });
    const resultAll = await collectGraph({ visibleOnly: false });
    expect(resultVisible).toBeDefined();
    expect(resultAll).toBeDefined();
    // The hidden form must not appear when visibleOnly: true
    const hiddenFormVisible = resultVisible!.forms.find((f) => f.formId === "hidden-form");
    expect(hiddenFormVisible).toBeUndefined();
    // But it should appear when visibleOnly: false
    const hiddenFormAll = resultAll!.forms.find((f) => f.formId === "hidden-form");
    expect(hiddenFormAll).toBeDefined();
  });

  it("B2-SG-009: visibleOnly: true excludes hidden fields within a visible form", async () => {
    // Add a hidden field inside the existing visible login form
    const loginForm = document.getElementById("login-form");
    if (loginForm !== null) {
      loginForm.insertAdjacentHTML("beforeend", `<input type="text" id="hidden-field" name="hidden-field" style="display:none;">`);
    }
    const resultVisible = await collectGraph({ visibleOnly: true });
    const resultAll = await collectGraph({ visibleOnly: false });
    expect(resultVisible).toBeDefined();
    expect(resultAll).toBeDefined();
    const loginFormVisible = resultVisible!.forms.find((f) => f.formId === "login-form");
    const loginFormAll = resultAll!.forms.find((f) => f.formId === "login-form");
    expect(loginFormVisible).toBeDefined();
    expect(loginFormAll).toBeDefined();
    // Hidden field should not be in visibleOnly result
    const hiddenFieldVisible = loginFormVisible!.fields.find((f) => f.name === "hidden-field");
    expect(hiddenFieldVisible).toBeUndefined();
    // But present in the include-all result
    const hiddenFieldAll = loginFormAll!.fields.find((f) => f.name === "hidden-field");
    expect(hiddenFieldAll).toBeDefined();
  });
});

function countAllNodes(result: SemanticGraphResult): number {
  let count = 0;
  for (const node of result.a11yTree) {
    count += countA11yNodes(node);
  }
  return count;
}

function countA11yNodes(node: SemanticA11yNode): number {
  let count = 1;
  for (const child of node.children) {
    count += countA11yNodes(child);
  }
  return count;
}

function findTextInA11y(nodes: SemanticA11yNode[], text: string): SemanticA11yNode | undefined {
  for (const node of nodes) {
    if (node.name?.includes(text)) return node;
    const found = findTextInA11y(node.children, text);
    if (found) return found;
  }
  return undefined;
}

// ── B2-SG-013: Password Redaction ────────────────────────────────────────────

describe("B2-SG-013: Password redaction", () => {
  it("B2-SG-013: Password field value is exactly '[REDACTED]'", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    const passwordField = result!.forms[0].fields.find((f) => f.type === "password");
    expect(passwordField).toBeDefined();
    // Per B2-SG-013: password value must be the exact string "[REDACTED]"
    expect(passwordField!.value).toBe("[REDACTED]");
  });
});

// ── B2-SG-014: Implicit ARIA Role Mapping ─────────────────────────────────────

describe("B2-SG-014: Implicit ARIA role mapping", () => {
  it("B2-SG-014: nav element maps to role 'navigation'", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    // The primary nav should have role "navigation" (implicit from <nav> element)
    const navLandmarks = result!.landmarks.filter((l) => l.tag === "nav");
    expect(navLandmarks.length).toBeGreaterThan(0);
    expect(navLandmarks.some((l) => l.role === "navigation")).toBe(true);
  });

  it("B2-SG-014: main element maps to role 'main'", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    const mainLandmark = result!.landmarks.find((l) => l.tag === "main");
    expect(mainLandmark).toBeDefined();
    expect(mainLandmark!.role).toBe("main");
  });

  it("B2-SG-014: header element maps to role 'banner'", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    const headerLandmark = result!.landmarks.find((l) => l.tag === "header");
    expect(headerLandmark).toBeDefined();
    expect(headerLandmark!.role).toBe("banner");
  });

  it("B2-SG-014: footer element maps to role 'contentinfo'", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    const footerLandmark = result!.landmarks.find((l) => l.tag === "footer");
    expect(footerLandmark).toBeDefined();
    expect(footerLandmark!.role).toBe("contentinfo");
  });

  it("B2-SG-014: aside element maps to role 'complementary'", async () => {
    const result = await collectGraph();
    expect(result).toBeDefined();
    const asideLandmark = result!.landmarks.find((l) => l.tag === "aside");
    expect(asideLandmark).toBeDefined();
    expect(asideLandmark!.role).toBe("complementary");
  });

  it("B2-SG-014: search element maps to role 'search'", async () => {
    document.body.innerHTML = `<search id="site-search" aria-label="Site search"><input type="search"></search>`;
    const result = await collectGraph();
    expect(result).toBeDefined();
    const searchLandmark = result!.landmarks.find((l) => l.tag === "search");
    expect(searchLandmark).toBeDefined();
    expect(searchLandmark!.role).toBe("search");
  });

  it("B2-SG-014: labelled section element maps to role 'region'", async () => {
    document.body.innerHTML = `<section id="labelled-section" aria-label="About us"><p>Content</p></section>`;
    const result = await collectGraph();
    expect(result).toBeDefined();
    const sectionLandmark = result!.landmarks.find((l) => l.tag === "section");
    expect(sectionLandmark).toBeDefined();
    expect(sectionLandmark!.role).toBe("region");
  });

  it("B2-SG-014: unlabelled section element does NOT map to role 'region'", async () => {
    document.body.innerHTML = `<section id="unlabelled-section"><p>Content without label</p></section>`;
    const result = await collectGraph();
    expect(result).toBeDefined();
    // Unlabelled <section> must NOT appear as a landmark
    const sectionLandmark = result!.landmarks.find((l) => l.tag === "section");
    expect(sectionLandmark).toBeUndefined();
  });

  it("B2-SG-014: section with title attribute maps to role 'region'", async () => {
    document.body.innerHTML = `<section id="titled-section" title="Products"><p>Products content</p></section>`;
    const result = await collectGraph();
    expect(result).toBeDefined();
    const sectionLandmark = result!.landmarks.find((l) => l.tag === "section");
    expect(sectionLandmark).toBeDefined();
    expect(sectionLandmark!.role).toBe("region");
  });
});

// ── B2-SG-003 (negative): Landmark role whitelist ─────────────────────────────

describe("B2-SG-003: Landmark role whitelist (negative cases)", () => {
  it("B2-SG-003: role='button' explicit attribute is NOT admitted as a landmark", async () => {
    document.body.innerHTML = `<div id="fake-landmark" role="button">Click me</div>`;
    const result = await collectGraph();
    expect(result).toBeDefined();
    // role="button" is not a landmark role — must not appear in landmarks
    const buttonLandmark = result!.landmarks.find((l) => l.role === "button");
    expect(buttonLandmark).toBeUndefined();
  });

  it("B2-SG-003: role='dialog' explicit attribute is NOT admitted as a landmark", async () => {
    document.body.innerHTML = `<div id="modal" role="dialog">Modal content</div>`;
    const result = await collectGraph();
    expect(result).toBeDefined();
    const dialogLandmark = result!.landmarks.find((l) => l.role === "dialog");
    expect(dialogLandmark).toBeUndefined();
  });

  it("B2-SG-003: role='alert' explicit attribute is NOT admitted as a landmark", async () => {
    document.body.innerHTML = `<div id="alert-box" role="alert">Alert!</div>`;
    const result = await collectGraph();
    expect(result).toBeDefined();
    const alertLandmark = result!.landmarks.find((l) => l.role === "alert");
    expect(alertLandmark).toBeUndefined();
  });

  it("B2-SG-003: role='navigation' (landmark role) IS admitted as a landmark", async () => {
    document.body.innerHTML = `<div id="nav-div" role="navigation" aria-label="Explicit nav">nav content</div>`;
    const result = await collectGraph();
    expect(result).toBeDefined();
    // role="navigation" IS a landmark role — must appear
    const navLandmark = result!.landmarks.find((l) => l.role === "navigation" && l.label === "Explicit nav");
    expect(navLandmark).toBeDefined();
  });

  it("B2-SG-003: role='region' with aria-label IS admitted as a landmark", async () => {
    document.body.innerHTML = `<div id="region-div" role="region" aria-label="Special region">content</div>`;
    const result = await collectGraph();
    expect(result).toBeDefined();
    const regionLandmark = result!.landmarks.find((l) => l.role === "region");
    expect(regionLandmark).toBeDefined();
  });
});

// ── B2-SG-015: Empty Sub-trees ────────────────────────────────────────────────

describe("B2-SG-015: Empty sub-trees", () => {
  it("B2-SG-015: Empty page has all four sub-tree arrays present and each equals []", async () => {
    // Set up empty DOM
    document.body.innerHTML = "";
    const result = await collectGraph();
    expect(result).toBeDefined();
    // Each sub-tree must explicitly equal [], not just be an array
    expect(result?.a11yTree).toEqual([]);
    expect(result?.landmarks).toEqual([]);
    expect(result?.outline).toEqual([]);
    expect(result?.forms).toEqual([]);
  });

  it("B2-SG-015: Page with no forms has empty forms array, not absent", async () => {
    document.body.innerHTML = `<h1>Hello</h1>`;
    const result = await collectGraph();
    expect(result).toBeDefined();
    expect("forms" in result!).toBe(true);
    expect(result?.forms).toEqual([]);
  });

  it("B2-SG-015: All four sub-tree fields are always present (never undefined)", async () => {
    document.body.innerHTML = `<h1>Hello</h1>`;
    const result = await collectGraph();
    expect(result).toBeDefined();
    expect(result?.a11yTree).not.toBeUndefined();
    expect(result?.landmarks).not.toBeUndefined();
    expect(result?.outline).not.toBeUndefined();
    expect(result?.forms).not.toBeUndefined();
  });
});

// ── B2-SG-010: Performance Budget ───────────────────────────────────────────

/**
 * Generates a realistic large DOM with approximately the requested node count.
 * Produces nested articles with headings, forms, nav sections, and buttons
 * to exercise all four sub-trees (a11y, landmarks, outline, forms).
 */
function setupLargeDOM(targetNodeCount: number): void {
  document.title = "M113-SEM Performance Test Page";
  const parts: string[] = [];
  let nodesProduced = 0;

  // Seed landmarks
  parts.push(`<header id="hdr"><nav id="n1" aria-label="Nav 1"><ul><li><a href="/">Link</a></li></ul></nav></header>`);
  parts.push(`<main id="mn"></main>`);
  parts.push(`<footer id="ftr"></footer>`);
  nodesProduced += 6; // header + nav + ul + li + a + main + footer

  while (nodesProduced < targetNodeCount) {
    const id = nodesProduced;
    // Article with heading hierarchy
    parts.push(`<article id="art${id}"><h2 id="h2-${id}">Heading ${id}</h2><p id="p${id}">Content</p></article>`);
    nodesProduced += 4; // article + h2 + p + text node

    // Form with fields
    parts.push(`<form id="f${id}"><input type="text" id="t${id}" name="t${id}"><input type="password" id="pw${id}" name="pw${id}"><button type="submit" id="b${id}">Go</button></form>`);
    nodesProduced += 4; // form + input:text + input:password + button

    // Nav section
    if (id % 3 === 0) {
      parts.push(`<nav id="n${id}" aria-label="Nav ${id}"><ul><li><a href="/${id}">Link ${id}</a></li></ul></nav>`);
      nodesProduced += 4;
    }

    // Aside with heading
    if (id % 7 === 0) {
      parts.push(`<aside id="as${id}"><h3 id="h3-${id}">Aside ${id}</h3><p>Aside content</p></aside>`);
      nodesProduced += 4;
    }
  }

  document.body.innerHTML = parts.join("\n");
}

describe("B2-SG-010: Performance budget", () => {
  it("SEMANTIC_GRAPH_TIMEOUT_MS is 15000", () => {
    expect(SEMANTIC_GRAPH_TIMEOUT_MS).toBe(15_000);
  });

  it("B2-SG-010: collectSemanticGraph with ~5000-node fixture completes under 15000ms", async () => {
    // Build a large DOM with ~5000 nodes to exercise realistic DOM complexity
    setupLargeDOM(5000);
    vi.stubGlobal("getBoundingClientRect", mockGetBoundingClientRect);

    const start = Date.now();
    const result = await collectGraph();
    const elapsed = Date.now() - start;

    expect(result).toBeDefined();
    // Assert the result actually has content (not stubbed out early)
    expect(result.a11yTree.length).toBeGreaterThan(0);
    // Performance budget: must complete within 15 seconds
    expect(elapsed).toBeLessThan(15_000);
  }, 15_000);
});

/**
 * a11y-states.test.ts
 *
 * Tests for MCP-A11Y-001 — Accessibility states array in SemanticA11yNode
 *
 * Tests validate:
 * - collectElementStates() maps DOM/ARIA properties to state strings
 * - buildA11yNode() includes states array when element has states
 * - buildA11yNode() omits states field when no states apply
 *
 * API checklist (collectElementStates):
 * - Returns 'disabled' when input.disabled === true
 * - Returns 'readonly' when input.readOnly === true
 * - Returns 'required' when input.required === true
 * - Returns 'checked' when input.checked === true
 * - Returns 'expanded' when aria-expanded='true'
 * - Returns 'collapsed' when aria-expanded='false'
 * - Returns 'selected' when aria-selected='true'
 * - Returns 'disabled' when aria-disabled='true' on generic elements
 * - Returns 'readonly' when aria-readonly='true' on generic elements
 * - Returns 'required' when aria-required='true' on generic elements
 * - Returns 'checked' when aria-checked='true' on generic elements
 * - Returns 'selected' when HTMLOptionElement.selected === true
 * - Returns 'hidden' when aria-hidden='true'
 * - Returns 'expanded' when <details open>
 * - Does NOT return non-spec states like 'pressed' or 'focused'
 * - Returns [] when no states apply
 * - Returns multiple states when multiple apply
 * - Is deterministic (same order every time)
 *
 * API checklist (buildA11yNode → SemanticA11yNode):
 * - MCP-A11Y-001: a11y node includes states array when element has states
 * - MCP-A11Y-001: a11y node omits states field when no states apply
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { collectElementStates } from "../src/content/semantic-graph-helpers.js";
import type { SemanticA11yNode } from "../src/content/semantic-graph-types.js";

// ── Test fixtures ──────────────────────────────────────────────────────────────

function makeMockHTMLElement(props: Record<string, unknown> = {}): HTMLElement {
  const el = document.createElement("div");
  Object.assign(el, props);
  return el;
}

function makeMockInputElement(props: Record<string, unknown> = {}): HTMLInputElement {
  const el = document.createElement("input") as HTMLInputElement;
  Object.assign(el, props);
  return el;
}

// ── collectElementStates unit tests ───────────────────────────────────────────

describe("collectElementStates", () => {
  it("returns 'disabled' when input is disabled", () => {
    const el = makeMockInputElement({ disabled: true });
    const states = collectElementStates(el);
    expect(states).toContain("disabled");
  });

  it("returns 'readonly' when input is readonly", () => {
    const el = makeMockInputElement({ readOnly: true });
    const states = collectElementStates(el);
    expect(states).toContain("readonly");
  });

  it("returns 'required' when input is required", () => {
    const el = makeMockInputElement({ required: true });
    const states = collectElementStates(el);
    expect(states).toContain("required");
  });

  it("returns 'checked' when checkbox is checked", () => {
    const el = makeMockInputElement({ type: "checkbox", checked: true });
    const states = collectElementStates(el);
    expect(states).toContain("checked");
  });

  it("returns 'expanded' when aria-expanded='true'", () => {
    const el = makeMockHTMLElement({});
    el.setAttribute("aria-expanded", "true");
    const states = collectElementStates(el);
    expect(states).toContain("expanded");
  });

  it("returns 'collapsed' when aria-expanded='false'", () => {
    const el = makeMockHTMLElement({});
    el.setAttribute("aria-expanded", "false");
    const states = collectElementStates(el);
    expect(states).toContain("collapsed");
  });

  it("returns 'selected' when aria-selected='true'", () => {
    const el = makeMockHTMLElement({});
    el.setAttribute("aria-selected", "true");
    const states = collectElementStates(el);
    expect(states).toContain("selected");
  });

  it("returns 'disabled' when aria-disabled='true' on a generic element", () => {
    const el = makeMockHTMLElement({});
    el.setAttribute("aria-disabled", "true");
    const states = collectElementStates(el);
    expect(states).toContain("disabled");
  });

  it("returns 'readonly' when aria-readonly='true' on a generic element", () => {
    const el = makeMockHTMLElement({});
    el.setAttribute("aria-readonly", "true");
    const states = collectElementStates(el);
    expect(states).toContain("readonly");
  });

  it("returns 'required' when aria-required='true' on a generic element", () => {
    const el = makeMockHTMLElement({});
    el.setAttribute("aria-required", "true");
    const states = collectElementStates(el);
    expect(states).toContain("required");
  });

  it("returns 'checked' when aria-checked='true' on a generic element", () => {
    const el = makeMockHTMLElement({});
    el.setAttribute("aria-checked", "true");
    const states = collectElementStates(el);
    expect(states).toContain("checked");
  });

  it("returns 'selected' when option.selected is true", () => {
    const el = document.createElement("option");
    el.selected = true;
    const states = collectElementStates(el);
    expect(states).toContain("selected");
  });

  it("returns 'hidden' when aria-hidden='true'", () => {
    const el = makeMockHTMLElement({});
    el.setAttribute("aria-hidden", "true");
    const states = collectElementStates(el);
    expect(states).toContain("hidden");
  });

  it("returns 'expanded' when <details open>", () => {
    const el = document.createElement("details");
    el.open = true;
    const states = collectElementStates(el);
    expect(states).toContain("expanded");
  });

  it("does not return non-spec states like 'pressed' or 'focused'", () => {
    const el = makeMockHTMLElement({});
    el.setAttribute("aria-pressed", "true");
    const states = collectElementStates(el);
    expect(states).not.toContain("pressed");
    expect(states).not.toContain("focused");
  });

  it("returns [] when no states apply", () => {
    const el = makeMockHTMLElement({});
    const states = collectElementStates(el);
    expect(states).toEqual([]);
  });

  it("returns multiple states when multiple apply", () => {
    const el = makeMockInputElement({ disabled: true, required: true });
    const states = collectElementStates(el);
    expect(states).toContain("disabled");
    expect(states).toContain("required");
    expect(states.length).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic (same order every time)", () => {
    const el = makeMockInputElement({ disabled: true, required: true });
    const states1 = collectElementStates(el);
    const states2 = collectElementStates(el);
    expect(states1).toEqual(states2);
  });
});

// ── SemanticA11yNode states field integration tests ────────────────────────────

describe("SemanticA11yNode states field", () => {
  // We test buildA11yNode by importing the a11y tree builder
  // Since the builder walks document.body, we set up DOM elements

  it("MCP-A11Y-001: a11y node includes states array when element has states", async () => {
    // Set up a button with disabled state
    const btn = document.createElement("button");
    btn.id = "disabled-btn";
    (btn as HTMLButtonElement & { disabled: boolean }).disabled = true;
    document.body.appendChild(btn);

    try {
      // Import the builder dynamically (uses document.body)
      const { buildA11yTree } = await import("../src/content/semantic-graph-a11y.js");
      const { NodeIdRegistry } = await import("../src/content/semantic-graph-helpers.js");
      const registry = new NodeIdRegistry();
      const tree = buildA11yTree(registry, 8, false);

      // Find the disabled button node
      function findNode(nodes: SemanticA11yNode[], id: string): SemanticA11yNode | null {
        for (const node of nodes) {
          const el = document.getElementById(id);
          if (el && registry.idFor(el) === node.nodeId) {
            return node;
          }
          const found = findNode(node.children, id);
          if (found) return found;
        }
        return null;
      }

      const disabledNode = findNode(tree, "disabled-btn");
      expect(disabledNode).not.toBeNull();
      expect(disabledNode?.states).toBeDefined();
      expect(disabledNode?.states?.length).toBeGreaterThan(0);
      expect(disabledNode?.states).toContain("disabled");
    } finally {
      document.body.removeChild(btn);
    }
  });

  it("MCP-A11Y-001: a11y node omits states field when no states apply", async () => {
    // Set up a plain div with no states
    const div = document.createElement("div");
    div.id = "plain-div";
    document.body.appendChild(div);

    try {
      const { buildA11yTree } = await import("../src/content/semantic-graph-a11y.js");
      const { NodeIdRegistry } = await import("../src/content/semantic-graph-helpers.js");
      const registry = new NodeIdRegistry();
      const tree = buildA11yTree(registry, 8, false);

      function findNode(nodes: SemanticA11yNode[], id: string): SemanticA11yNode | null {
        for (const node of nodes) {
          const el = document.getElementById(id);
          if (el && registry.idFor(el) === node.nodeId) {
            return node;
          }
          const found = findNode(node.children, id);
          if (found) return found;
        }
        return null;
      }

      const plainNode = findNode(tree, "plain-div");
      expect(plainNode).not.toBeNull();
      // states should be undefined (not present), not an empty array
      expect("states" in plainNode!).toBe(false);
    } finally {
      document.body.removeChild(div);
    }
  });
});

// ── C4: Shadow DOM traversal tests (B2-VD-001..002) ──────────────────────────

/**
 * Tests for B2-VD-001: Shadow DOM traversal when piercesShadow is true.
 * B2-VD-001: Shadow DOM annotation — inShadowRoot: true, shadowHostId.
 * B2-VD-002: Nested shadow roots — shadowHostId updates at each host boundary.
 */
describe("buildA11yTree — C4: Shadow DOM traversal", () => {
  it("B2-VD-001: shadow nodes are annotated with inShadowRoot: true", async () => {
    const { buildA11yTree } = await import("../src/content/semantic-graph-a11y.js");
    const { NodeIdRegistry } = await import("../src/content/semantic-graph-helpers.js");

    // Create a shadow host with a button inside its shadow root
    const host = document.createElement("div");
    host.id = "shadow-host-001";
    const shadow = host.attachShadow({ mode: "open" });
    const btn = document.createElement("button");
    btn.textContent = "Shadow Button";
    shadow.appendChild(btn);
    document.body.appendChild(host);

    try {
      const registry = new NodeIdRegistry();
      const tree = buildA11yTree(registry, 8, false, true /* piercesShadow */);

      // Find any node with inShadowRoot: true
      function findShadowNodes(nodes: SemanticA11yNode[]): SemanticA11yNode[] {
        const found: SemanticA11yNode[] = [];
        for (const node of nodes) {
          if (node.inShadowRoot === true) found.push(node);
          found.push(...findShadowNodes(node.children));
        }
        return found;
      }

      const shadowNodes = findShadowNodes(tree);
      expect(shadowNodes.length).toBeGreaterThan(0);
      expect(shadowNodes[0]!.inShadowRoot).toBe(true);
    } finally {
      document.body.removeChild(host);
    }
  });

  it("B2-VD-001: shadow nodes carry shadowHostId matching the host element", async () => {
    const { buildA11yTree } = await import("../src/content/semantic-graph-a11y.js");
    const { NodeIdRegistry } = await import("../src/content/semantic-graph-helpers.js");

    const host = document.createElement("div");
    host.id = "shadow-host-002";
    const shadow = host.attachShadow({ mode: "open" });
    const btn = document.createElement("button");
    btn.textContent = "Host ID Test";
    shadow.appendChild(btn);
    document.body.appendChild(host);

    try {
      const registry = new NodeIdRegistry();
      const hostNodeId = registry.idFor(host);
      const tree = buildA11yTree(registry, 8, false, true);

      function findShadowNodes(nodes: SemanticA11yNode[]): SemanticA11yNode[] {
        const found: SemanticA11yNode[] = [];
        for (const node of nodes) {
          if (node.inShadowRoot === true) found.push(node);
          found.push(...findShadowNodes(node.children));
        }
        return found;
      }

      const shadowNodes = findShadowNodes(tree);
      expect(shadowNodes.length).toBeGreaterThan(0);
      // All shadow nodes should reference the host's nodeId
      expect(shadowNodes.every(n => n.shadowHostId === hostNodeId)).toBe(true);
    } finally {
      document.body.removeChild(host);
    }
  });

  it("B2-VD-001: piercesShadow=false does not produce shadow-annotated nodes", async () => {
    const { buildA11yTree } = await import("../src/content/semantic-graph-a11y.js");
    const { NodeIdRegistry } = await import("../src/content/semantic-graph-helpers.js");

    const host = document.createElement("div");
    host.id = "shadow-host-003";
    const shadow = host.attachShadow({ mode: "open" });
    const btn = document.createElement("button");
    btn.textContent = "No Pierce";
    shadow.appendChild(btn);
    document.body.appendChild(host);

    try {
      const registry = new NodeIdRegistry();
      const tree = buildA11yTree(registry, 8, false, false /* piercesShadow=false */);

      function findShadowNodes(nodes: SemanticA11yNode[]): SemanticA11yNode[] {
        const found: SemanticA11yNode[] = [];
        for (const node of nodes) {
          if (node.inShadowRoot === true) found.push(node);
          found.push(...findShadowNodes(node.children));
        }
        return found;
      }

      const shadowNodes = findShadowNodes(tree);
      expect(shadowNodes.length).toBe(0);
    } finally {
      document.body.removeChild(host);
    }
  });

  it("B2-VD-002: nested shadow root — inner shadow nodes get inner host's nodeId", async () => {
    const { buildA11yTree } = await import("../src/content/semantic-graph-a11y.js");
    const { NodeIdRegistry } = await import("../src/content/semantic-graph-helpers.js");

    // Outer shadow host
    const outerHost = document.createElement("div");
    outerHost.id = "outer-shadow-host";
    const outerShadow = outerHost.attachShadow({ mode: "open" });

    // Inner shadow host inside outer shadow
    const innerHost = document.createElement("div");
    innerHost.id = "inner-shadow-host";
    outerShadow.appendChild(innerHost);

    // Inner shadow root on innerHost
    const innerShadow = innerHost.attachShadow({ mode: "open" });
    const innerBtn = document.createElement("button");
    innerBtn.textContent = "Nested Shadow";
    innerShadow.appendChild(innerBtn);

    document.body.appendChild(outerHost);

    try {
      const registry = new NodeIdRegistry();
      const outerHostId = registry.idFor(outerHost);
      const innerHostId = registry.idFor(innerHost);
      const tree = buildA11yTree(registry, 16, false, true);

      // Collect all nodes with their shadowHostId
      function collectAll(nodes: SemanticA11yNode[]): SemanticA11yNode[] {
        const found: SemanticA11yNode[] = [];
        for (const node of nodes) {
          found.push(node);
          found.push(...collectAll(node.children));
        }
        return found;
      }

      const allNodes = collectAll(tree);
      const shadowNodes = allNodes.filter(n => n.inShadowRoot === true);

      // We should have shadow nodes from both levels
      expect(shadowNodes.length).toBeGreaterThan(0);

      // innerHost node itself is inside the outer shadow — its shadowHostId is outerHostId
      const innerHostNode = allNodes.find(n => n.shadowHostId === outerHostId && n.inShadowRoot === true);
      expect(innerHostNode).toBeDefined();

      // The button inside innerShadow — its shadowHostId should be innerHostId (not outerHostId)
      const innerBtnNodes = shadowNodes.filter(n => n.shadowHostId === innerHostId);
      expect(innerBtnNodes.length).toBeGreaterThan(0);
    } finally {
      document.body.removeChild(outerHost);
    }
  });
});

/**
 * a11y-states.test.ts
 *
 * Tests for GAP-C1 + MCP-A11Y-002 — Accessibility states array in SemanticA11yNode
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
 * - Returns 'pressed' when aria-pressed='true'
 * - Returns 'focused' when document.activeElement === element
 * - Returns 'hidden' when element.hasAttribute('hidden')
 * - Returns [] when no states apply
 * - Returns multiple states when multiple apply
 * - Is deterministic (same order every time)
 *
 * API checklist (buildA11yNode → SemanticA11yNode):
 * - MCP-A11Y-002: a11y node includes states array when element has states
 * - MCP-A11Y-002: a11y node omits states field when no states apply
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

  it("returns 'pressed' when aria-pressed='true'", () => {
    const el = makeMockHTMLElement({});
    el.setAttribute("aria-pressed", "true");
    const states = collectElementStates(el);
    expect(states).toContain("pressed");
  });

  it("returns 'focused' when element is activeElement", () => {
    const el = makeMockHTMLElement({});
    // Simulate element being the activeElement
    Object.defineProperty(document, "activeElement", {
      value: el,
      writable: true,
      configurable: true,
    });
    const states = collectElementStates(el);
    expect(states).toContain("focused");
  });

  it("returns 'hidden' when element has hidden attribute", () => {
    const el = makeMockHTMLElement({});
    el.setAttribute("hidden", "");
    const states = collectElementStates(el);
    expect(states).toContain("hidden");
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

  it("MCP-A11Y-002: a11y node includes states array when element has states", async () => {
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

  it("MCP-A11Y-002: a11y node omits states field when no states apply", async () => {
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

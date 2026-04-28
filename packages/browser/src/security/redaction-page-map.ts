import type { RedactionPolicy } from "./security-types.js";
import { redactText } from "./redaction-patterns.js";
import type { PageMapLike } from "./redaction-response-types.js";

export function redactPageMapResponse(response: PageMapLike, policy: RedactionPolicy): boolean {
  if (!response.nodes || response.nodes.length === 0) return false;
  let anyApplied = false;
  for (const node of response.nodes) {
    if (typeof node === "object" && node !== null) {
      anyApplied = redactPageMapNode(node as Record<string, unknown>, policy) || anyApplied;
    }
  }
  return anyApplied;
}

function redactPageMapNode(node: Record<string, unknown>, policy: RedactionPolicy): boolean {
  let anyApplied = false;
  anyApplied = redactNodeField(node, "name", policy) || anyApplied;
  anyApplied = redactNodeField(node, "text", policy) || anyApplied;
  for (const child of Array.isArray(node.children) ? node.children : []) {
    if (typeof child === "object" && child !== null) {
      anyApplied = redactPageMapNode(child as Record<string, unknown>, policy) || anyApplied;
    }
  }
  return anyApplied;
}

function redactNodeField(node: Record<string, unknown>, key: "name" | "text", policy: RedactionPolicy): boolean {
  if (typeof node[key] !== "string" || node[key].length === 0) return false;
  const r = redactText(node[key], policy);
  node[key] = r.text;
  return r.redactionApplied;
}

import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
import { resolveReportedAnchorMetadata } from "./anchor-resolution-metadata.js";
import { resolveElement } from "./element-inspector-resolver.js";
import type { DomExcerptResult } from "./element-inspector-types.js";

const SAFE_ATTRS = new Set([
  "id", "class", "role", "aria-label", "aria-labelledby", "aria-describedby",
  "href", "src", "alt", "title", "type", "name", "value", "data-testid",
  "data-cy", "data-test", "placeholder", "for", "rel",
]);
const FORBIDDEN_TAGS = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "noscript", "template", "svg", "canvas"]);
const URL_ATTRS = new Set(["href", "src", "action"]);
const DANGEROUS_URL_PREFIXES = ["javascript:", "data:"];

function isSafeUrl(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return !DANGEROUS_URL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeElement(
  element: Element,
  currentDepth: number,
  maxDepth: number,
  counter: { count: number },
): string {
  const tag = element.tagName.toLowerCase();
  if (FORBIDDEN_TAGS.has(tag)) return "";

  const attrParts: string[] = [];
  for (const attr of Array.from(element.attributes)) {
    if (attr.name.startsWith("on")) continue;
    if (!SAFE_ATTRS.has(attr.name)) continue;
    if (URL_ATTRS.has(attr.name) && !isSafeUrl(attr.value)) continue;
    attrParts.push(`${attr.name}="${escapeHtmlText(attr.value).replace(/"/g, "&quot;")}"`);
  }

  const attrStr = attrParts.length > 0 ? ` ${attrParts.join(" ")}` : "";
  const openTag = `<${tag}${attrStr}>`;
  const closeTag = `</${tag}>`;
  counter.count++;

  if (currentDepth >= maxDepth || element.childNodes.length === 0) {
    const text = (element.textContent ?? "").trim();
    const inner = text ? escapeHtmlText(text) : "";
    return `${openTag}${inner}${closeTag}`;
  }

  let inner = "";
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? "").replace(/\s+/g, " ");
      if (text.trim().length > 0) inner += escapeHtmlText(text);
      continue;
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      inner += serializeElement(child as Element, currentDepth + 1, maxDepth, counter);
    }
  }
  return `${openTag}${inner}${closeTag}`;
}

export function getDomExcerpt(
  target: string | { selector?: string; anchorKey?: string; creationSnapshotId?: string },
  maxDepth = 3,
  maxLength = 2000,
): DomExcerptResult {
  const envelope = captureSnapshotEnvelope("dom");
  const selector = typeof target === "string" ? target : target.selector;
  const anchorKey = typeof target === "string" ? undefined : target.anchorKey;
  const creationSnapshotId = typeof target === "string" ? undefined : target.creationSnapshotId;
  const element = resolveElement({ selector, anchorKey });
  if (!element) return { ...envelope, found: false };

  const counter = { count: 0 };
  let html = serializeElement(element, 0, maxDepth, counter);
  const text = (element.textContent ?? "").trim();
  const nodeCount = counter.count;
  let truncated = false;
  if (html.length > maxLength) {
    html = html.slice(0, maxLength);
    truncated = true;
  }

  return {
    ...envelope,
    found: true,
    ...resolveReportedAnchorMetadata(anchorKey, element, envelope.snapshotId, creationSnapshotId),
    html,
    text,
    nodeCount,
    truncated,
  };
}

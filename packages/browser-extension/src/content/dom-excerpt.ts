import { captureSnapshotEnvelope } from "../snapshot-versioning.js";
import { resolveReportedAnchorMetadata } from "./anchor-resolution-metadata.js";
import { resolveElement } from "./element-inspector-resolver.js";
import type { DomExcerptResult } from "./element-inspector-types.js";
import { boundExcerpt, escapeHtmlText, normalizeNodeText, normalizeTarget, normalizeText, type SerializeResult } from "./dom-excerpt-helpers.js";

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

function serializeElement(
  element: Element,
  currentDepth: number,
  maxDepth: number,
  counter: { count: number },
): SerializeResult {
  const tag = element.tagName.toLowerCase();
  if (FORBIDDEN_TAGS.has(tag)) return { html: "", text: "" };
  const { openTag, closeTag } = buildTags(element, tag);
  counter.count++;

  if (currentDepth >= maxDepth || element.childNodes.length === 0) {
    return serializeCutoffElement(element, openTag, closeTag);
  }

  const inner = serializeChildren(element, currentDepth, maxDepth, counter);
  return {
    html: `${openTag}${inner.html}${closeTag}`,
    text: normalizeText(inner.text.join(" ")),
  };
}

function serializeChildren(
  element: Element,
  currentDepth: number,
  maxDepth: number,
  counter: { count: number },
): { html: string; text: string[] } {
  let html = "";
  const innerText: string[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = normalizeNodeText(child.textContent ?? "");
      if (text.length > 0) {
        html += escapeHtmlText(text);
        innerText.push(normalizeText(text));
      }
      continue;
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      const childResult = serializeElement(child as Element, currentDepth + 1, maxDepth, counter);
      html += childResult.html;
      if (childResult.text.length > 0) {
        innerText.push(childResult.text);
      }
    }
  }
  return { html, text: innerText };
}

export function getDomExcerpt(
  target: string | { selector?: string; anchorKey?: string; creationSnapshotId?: string },
  maxDepth = 3,
  maxLength = 2000,
): DomExcerptResult {
  const envelope = captureSnapshotEnvelope("dom");
  const { selector, anchorKey, creationSnapshotId } = normalizeTarget(target);
  const element = resolveElement({ selector, anchorKey });
  if (!element) return { ...envelope, found: false };

  const counter = { count: 0 };
  const excerpt = serializeElement(element, 0, maxDepth, counter);
  const bounded = boundExcerpt(excerpt, maxLength);

  return {
    ...envelope,
    found: true,
    ...resolveReportedAnchorMetadata(anchorKey, element, envelope.snapshotId, creationSnapshotId),
    html: bounded.html,
    text: bounded.text,
    nodeCount: counter.count,
    truncated: bounded.truncated,
  };
}

function buildTags(element: Element, tag: string): { openTag: string; closeTag: string } {
  const attrParts = Array.from(element.attributes)
    .filter((attr) => !attr.name.startsWith("on"))
    .filter((attr) => SAFE_ATTRS.has(attr.name))
    .filter((attr) => !URL_ATTRS.has(attr.name) || isSafeUrl(attr.value))
    .map((attr) => `${attr.name}="${escapeHtmlText(attr.value).replace(/"/g, "&quot;")}"`);
  const attrStr = attrParts.length > 0 ? ` ${attrParts.join(" ")}` : "";
  return { openTag: `<${tag}${attrStr}>`, closeTag: `</${tag}>` };
}

function serializeCutoffElement(element: Element, openTag: string, closeTag: string): SerializeResult {
  const directText = collectDirectText(element);
  const inner = directText ? escapeHtmlText(directText) : "";
  return { html: `${openTag}${inner}${closeTag}`, text: directText };
}

function collectDirectText(element: Element): string {
  return normalizeText(
    Array.from(element.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? "")
      .join(" "),
  );
}

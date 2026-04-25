import { generateAnchorKey } from "./enhanced-anchor.js";
import { collectElementStates } from "./semantic-graph-helpers.js";
import type { ElementContext, ElementDetail } from "./element-inspector-types.js";

const LANDMARK_TAGS = new Set(["header", "nav", "main", "footer", "aside", "section", "article", "form"]);

function computeVisibilityConfidence(element: Element): "high" | "medium" | "low" {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return "low";
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0" || element.hasAttribute("hidden")) {
    return "low";
  }
  if (rect.top > window.innerHeight || rect.left > window.innerWidth) return "medium";
  return "high";
}

function getNearestLandmark(element: Element): string | undefined {
  let current = element.parentElement;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (LANDMARK_TAGS.has(tag)) return tag;
    const role = current.getAttribute("role");
    if (role && LANDMARK_TAGS.has(role)) return role;
    current = current.parentElement;
  }
  return undefined;
}

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = el.classList.length > 0 ? `.${Array.from(el.classList).slice(0, 2).join(".")}` : "";
  return `${tag}${id}${cls}`;
}

function buildContext(element: Element): ElementContext {
  const parentChain: string[] = [];
  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 3) {
    parentChain.unshift(describeElement(current));
    current = current.parentElement;
    depth++;
  }

  const parent = element.parentElement;
  const siblings = parent ? Array.from(parent.children) : [element];
  return {
    parentChain,
    siblingCount: siblings.length,
    siblingIndex: siblings.indexOf(element),
    nearestLandmark: getNearestLandmark(element),
  };
}

function buildDetail(element: Element): ElementDetail {
  const tag = element.tagName.toLowerCase();
  const id = element.id || undefined;
  const classList = element.classList.length > 0 ? Array.from(element.classList) : undefined;
  const role = element.getAttribute("role") ?? undefined;
  const ariaLabel = element.getAttribute("aria-label") ?? undefined;
  const textContent = (element.textContent ?? "").trim().slice(0, 100) || undefined;

  const attributes: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) attributes[attr.name] = attr.value;

  const testIds: Record<string, string> = {};
  for (const attr of ["data-testid", "data-cy", "data-test"]) {
    const val = element.getAttribute(attr);
    if (val !== null) testIds[attr] = val;
  }

  const rect = element.getBoundingClientRect();
  const bounds = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledByText = labelledBy
    ? labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter((text) => text.length > 0)
        .join(" ")
    : undefined;
  const htmlElement = element as HTMLElement;
  const controlLabels = ("labels" in htmlElement
    ? Array.from((htmlElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).labels ?? [])
    : [])
    .map((label) => label.textContent?.trim() ?? "")
    .filter((text) => text.length > 0)
    .join(" ");
  const textLabel = tag === "button" ? (element.textContent ?? "").trim() || undefined : undefined;
  const accessibleName =
    ariaLabel ??
    labelledByText ??
    (controlLabels.length > 0 ? controlLabels : undefined) ??
    textLabel ??
    element.getAttribute("alt") ??
    element.getAttribute("title") ??
    undefined;
  const visibleConfidence = computeVisibilityConfidence(element);
  const states = collectElementStates(element as HTMLElement);
  const el = element as HTMLElement;
  const isDisabled = el.getAttribute("aria-disabled") === "true" || ((el instanceof HTMLInputElement || el instanceof HTMLButtonElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) && el.disabled);
  const isReadonly = el.getAttribute("aria-readonly") === "true" || ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly);
  const isFormControl = el instanceof HTMLInputElement || el instanceof HTMLButtonElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  const isFocused = document.activeElement === element;
  const isChecked = (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) ? el.checked : el.getAttribute("aria-checked") === "true" ? true : el.getAttribute("aria-checked") === "false" ? false : undefined;
  const isExpanded = el.getAttribute("aria-expanded") === "true" ? true : el.getAttribute("aria-expanded") === "false" ? false : (el instanceof HTMLDetailsElement ? el.open : undefined);
  const isSelected = el.getAttribute("aria-selected") === "true" ? true : el.getAttribute("aria-selected") === "false" ? false : (el instanceof HTMLOptionElement ? el.selected : undefined);
  const isInvalid = el.getAttribute("aria-invalid") === "true" ? true : el.getAttribute("aria-invalid") === "false" ? false : (isFormControl && (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).validity !== undefined ? !(el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).validity.valid : undefined);
  const isRequired = el.getAttribute("aria-required") === "true" || (isFormControl && (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).required) ? true : undefined;
  const computedStyle = window.getComputedStyle(element);
  const hasPointerEvents = computedStyle.pointerEvents !== "none";
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  let isObstructed: boolean | undefined;
  if (rect.width > 0 && rect.height > 0 && typeof document.elementFromPoint === "function") {
    const top = document.elementFromPoint(centerX, centerY);
    isObstructed = top !== null && !element.contains(top);
  }

  return {
    tag,
    id,
    classList,
    role,
    ariaLabel,
    textContent,
    attributes,
    bounds,
    visible: visibleConfidence !== "low",
    visibleConfidence,
    accessibleName,
    testIds: Object.keys(testIds).length > 0 ? testIds : undefined,
    ...(states.length > 0 ? { states } : {}),
    ...(isFormControl ? { disabled: isDisabled } : {}),
    ...(isFormControl && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ? { readonly: isReadonly } : {}),
    ...(isFocused ? { focused: true } : {}),
    ...(isChecked !== undefined ? { checked: isChecked } : {}),
    ...(isExpanded !== undefined ? { expanded: isExpanded } : {}),
    ...(isSelected !== undefined ? { selected: isSelected } : {}),
    ...(isInvalid !== undefined ? { invalid: isInvalid } : {}),
    ...(isRequired !== undefined ? { required: isRequired } : {}),
    hasPointerEvents,
    ...(isObstructed !== undefined ? { isObstructed } : {}),
    clickTargetSize: { width: Math.round(rect.width), height: Math.round(rect.height) },
  };
}

export function inspectResolvedElement(element: Element): {
  anchorKey: string;
  strategy: "id" | "data-testid" | "aria" | "css-path" | "tag-sibling" | "viewport-pct";
  confidence: "high" | "medium" | "low";
  detail: ElementDetail;
  context: ElementContext;
} {
  const { anchorKey, strategy, confidence } = generateAnchorKey(element);
  const detail = buildDetail(element);
  const context = buildContext(element);
  return { anchorKey, strategy, confidence, detail, context };
}

import { collectElementStates } from "./semantic-graph-helpers.js";
import type { ElementDetail } from "./element-inspector-types.js";
import type { BasicDetailFields, DetailStateData } from "./element-inspector-detail-build-types.js";

function computeVisibilityConfidence(element: Element): "high" | "medium" | "low" {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return "low";
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0" || element.hasAttribute("hidden")) return "low";
  if (rect.top > window.innerHeight || rect.left > window.innerWidth) return "medium";
  return "high";
}

function buildAttributes(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(element.attributes)) attrs[attr.name] = attr.value;
  return attrs;
}

function buildTestIds(element: Element): Record<string, string> | undefined {
  const testIdAttrs = ["data-testid", "data-cy", "data-test"];
  const found: Record<string, string> = {};
  for (const attr of testIdAttrs) {
    const val = element.getAttribute(attr);
    if (val !== null) found[attr] = val;
  }
  return Object.keys(found).length > 0 ? found : undefined;
}

function buildBounds(rect: DOMRect): { x: number; y: number; width: number; height: number } {
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
}

function buildAccessibleName(
  element: Element,
  tag: string,
  ariaLabel: string | undefined,
  labelledByText: string | undefined,
  controlLabels: string,
): string | undefined {
  return (
    ariaLabel ??
    labelledByText ??
    (controlLabels.length > 0 ? controlLabels : undefined) ??
    (tag === "button" ? (element.textContent ?? "").trim() || undefined : undefined) ??
    element.getAttribute("alt") ??
    element.getAttribute("title") ??
    undefined
  );
}

function collectAriaStates(el: HTMLElement): Record<string, boolean | undefined> {
  const isFormControl = el instanceof HTMLInputElement || el instanceof HTMLButtonElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  const isDisabled = el.getAttribute("aria-disabled") === "true" || (isFormControl && (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).disabled);
  const isReadonly = el.getAttribute("aria-readonly") === "true" || ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly);
  const isChecked = (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) ? el.checked : el.getAttribute("aria-checked") === "true" ? true : el.getAttribute("aria-checked") === "false" ? false : undefined;
  const isExpanded = el.getAttribute("aria-expanded") === "true" ? true : el.getAttribute("aria-expanded") === "false" ? false : (el instanceof HTMLDetailsElement ? el.open : undefined);
  const isSelected = el.getAttribute("aria-selected") === "true" ? true : el.getAttribute("aria-selected") === "false" ? false : (el instanceof HTMLOptionElement ? el.selected : undefined);
  const isInvalid = el.getAttribute("aria-invalid") === "true" ? true : el.getAttribute("aria-invalid") === "false" ? false : (isFormControl && (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).validity !== undefined ? !(el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).validity.valid : undefined);
  const isRequired = el.getAttribute("aria-required") === "true" || (isFormControl && (el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).required) ? true : undefined;
  return { isDisabled, isReadonly, isChecked, isExpanded, isSelected, isInvalid, isRequired, isFormControl };
}

function computeObstruction(element: Element, rect: DOMRect): boolean | undefined {
  if (rect.width > 0 && rect.height > 0 && typeof document.elementFromPoint === "function") {
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const top = document.elementFromPoint(centerX, centerY);
    return top !== null && !element.contains(top);
  }
  return undefined;
}

export function buildDetail(element: Element): ElementDetail {
  const tag = element.tagName.toLowerCase();
  const basics = buildBasicDetailFields(element, tag);
  const labelData = buildLabelData(element, tag, basics.ariaLabel);
  const stateData = buildStateData(element, basics.rect);
  return buildDetailResponse(tag, basics, labelData.accessibleName, stateData);
}

function buildBasicDetailFields(element: Element, tag: string): BasicDetailFields {
  const rect = element.getBoundingClientRect();
  return {
    rect,
    id: element.id || undefined,
    classList: element.classList.length > 0 ? Array.from(element.classList) : undefined,
    role: element.getAttribute("role") ?? undefined,
    ariaLabel: element.getAttribute("aria-label") ?? undefined,
    textContent: (element.textContent ?? "").trim().slice(0, 100) || undefined,
    attributes: buildAttributes(element),
    testIds: buildTestIds(element),
    bounds: buildBounds(rect),
    visibleConfidence: computeVisibilityConfidence(element),
  };
}

function buildLabelData(element: Element, tag: string, ariaLabel: string | undefined): { accessibleName: string | undefined } {
  const htmlElement = element as HTMLElement;
  const labelledBy = element.getAttribute("aria-labelledby");
  const labelledByText = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter((t) => t.length > 0).join(" ") : undefined;
  const controlLabels = ("labels" in htmlElement ? Array.from((htmlElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).labels ?? []) : []).map((l) => l.textContent?.trim() ?? "").filter((t) => t.length > 0).join(" ");
  return { accessibleName: buildAccessibleName(element, tag, ariaLabel, labelledByText, controlLabels) };
}

function buildStateData(element: Element, rect: DOMRect): DetailStateData {
  const htmlElement = element as HTMLElement;
  return {
    states: collectElementStates(htmlElement),
    ariaStates: collectAriaStates(htmlElement),
    hasPointerEvents: window.getComputedStyle(element).pointerEvents !== "none",
    isObstructed: computeObstruction(element, rect),
  };
}

function buildDetailResponse(tag: string, basics: BasicDetailFields, accessibleName: string | undefined, stateData: DetailStateData): ElementDetail {
  const { ariaStates, states, hasPointerEvents, isObstructed } = stateData;
  const rect = basics.rect;
  return {
    tag,
    id: basics.id,
    classList: basics.classList,
    role: basics.role,
    ariaLabel: basics.ariaLabel,
    textContent: basics.textContent,
    attributes: basics.attributes,
    bounds: basics.bounds,
    visible: basics.visibleConfidence !== "low",
    visibleConfidence: basics.visibleConfidence,
    accessibleName,
    testIds: basics.testIds,
    ...(states.length > 0 ? { states } : {}),
    ...(ariaStates.isFormControl ? { disabled: ariaStates.isDisabled } : {}),
    ...(ariaStates.isFormControl ? { readonly: ariaStates.isReadonly } : {}),
    hasPointerEvents,
    ...(isObstructed !== undefined ? { isObstructed } : {}),
    clickTargetSize: { width: Math.round(rect.width), height: Math.round(rect.height) },
  };
}

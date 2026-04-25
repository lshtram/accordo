import type { FormField } from "./semantic-graph-types.js";
import type { NodeIdRegistry } from "./semantic-graph-helpers.js";

function resolveFieldLabel(el: HTMLElement): string | undefined {
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel !== null && ariaLabel.trim().length > 0) return ariaLabel.trim();

  const id = el.getAttribute("id");
  if (id !== null && id.length > 0) {
    const labelEl = document.querySelector(`label[for="${id}"]`);
    if (labelEl !== null) {
      const text = labelEl.textContent?.trim();
      if (text && text.length > 0) return text;
    }
  }

  const parent = el.closest("label");
  if (parent !== null) {
    const text = parent.textContent?.trim();
    if (text && text.length > 0) return text;
  }

  const title = el.getAttribute("title");
  if (title !== null && title.trim().length > 0) return title.trim();

  if (el.tagName.toLowerCase() === "button") {
    const text = el.textContent?.trim();
    if (text && text.length > 0) return text;
  }

  return undefined;
}

function extractConstraints(el: HTMLElement): FormField["constraints"] {
  const constraints: NonNullable<FormField["constraints"]> = {};
  const minLength = el.getAttribute("minlength");
  if (minLength !== null) constraints.minLength = parseInt(minLength, 10);
  const maxLength = el.getAttribute("maxlength");
  if (maxLength !== null) constraints.maxLength = parseInt(maxLength, 10);
  const min = el.getAttribute("min");
  if (min !== null) {
    const numeric = parseFloat(min);
    constraints.min = isNaN(numeric) ? min : numeric;
  }
  const max = el.getAttribute("max");
  if (max !== null) {
    const numeric = parseFloat(max);
    constraints.max = isNaN(numeric) ? max : numeric;
  }
  const pattern = el.getAttribute("pattern");
  if (pattern !== null && pattern.length > 0) constraints.pattern = pattern;
  const step = el.getAttribute("step");
  if (step !== null && step.length > 0) {
    const numeric = parseFloat(step);
    constraints.step = isNaN(numeric) ? step : numeric;
  }
  return Object.keys(constraints).length > 0 ? constraints : undefined;
}

export function extractField(fieldEl: HTMLElement, registry: NodeIdRegistry): FormField {
  const fieldTag = fieldEl.tagName.toLowerCase();
  const fieldNodeId = registry.idFor(fieldEl);
  const fieldType = fieldEl.getAttribute("type") ?? undefined;
  const uid = registry.uidFor(fieldEl);

  const field: FormField = {
    tag: fieldTag,
    required: (fieldEl as HTMLInputElement).required ?? false,
    nodeId: fieldNodeId,
    ...(uid !== undefined ? { uid } : {}),
  };

  if (fieldType !== undefined) field.type = fieldType;
  const fieldName = fieldEl.getAttribute("name");
  if (fieldName !== null && fieldName.length > 0) field.name = fieldName;
  const label = resolveFieldLabel(fieldEl);
  if (label !== undefined) field.label = label;

  if (fieldType === "password") {
    field.value = "[REDACTED]";
  } else {
    const value = (fieldEl as HTMLInputElement).value;
    if (value !== undefined && value !== null) field.value = value;
  }

  const isFormControl = fieldEl instanceof HTMLInputElement || fieldEl instanceof HTMLTextAreaElement || fieldEl instanceof HTMLSelectElement;
  if (isFormControl) {
    const el = fieldEl as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const validity = el.validity;
    if (validity) {
      if (!validity.valid) {
        field.validationState = "invalid";
        field.validationMessage = el.validationMessage;
      } else if (validity.valueMissing || validity.typeMismatch || validity.patternMismatch || validity.tooLong || validity.tooShort || validity.rangeUnderflow || validity.rangeOverflow || validity.stepMismatch) {
        field.validationState = "valid";
      }
    }
    if ("disabled" in el) field.disabled = el.disabled;
    if ("readOnly" in el) field.readonly = el.readOnly;
    field.constraints = extractConstraints(fieldEl);
  }

  return field;
}

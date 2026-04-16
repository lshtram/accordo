/**
 * M113-SEM — Form model extractor.
 *
 * B2-SG-005, B2-SG-009, B2-SG-013.
 * B2-FORM-EXT: validationState, validationMessage, constraints, summary.
 *
 * @module
 */

import type { FormField, FormModel } from "./semantic-graph-types.js";
import type { NodeIdRegistry } from "./semantic-graph-helpers.js";
import { isHidden } from "./semantic-graph-helpers.js";

// ── Field label resolution ────────────────────────────────────────────────────

/**
 * Resolve the label text for a form field.
 * Checks: aria-label > explicit <label for="id"> > wrapping <label> > title.
 */
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

  const tag = el.tagName.toLowerCase();
  if (tag === "button") {
    const text = el.textContent?.trim();
    if (text && text.length > 0) return text;
  }

  return undefined;
}

// ── Constraint extraction ────────────────────────────────────────────────────

/**
 * Extract constraint attributes from a form element.
 * B2-FORM-EXT.
 */
function extractConstraints(el: HTMLElement): FormField["constraints"] {
  const constraints: NonNullable<FormField["constraints"]> = {};

  const minLength = el.getAttribute("minlength");
  if (minLength !== null) constraints.minLength = parseInt(minLength, 10);

  const maxLength = el.getAttribute("maxlength");
  if (maxLength !== null) constraints.maxLength = parseInt(maxLength, 10);

  const min = el.getAttribute("min");
  if (min !== null) {
    // Try numeric first, fall back to string for date etc.
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

// ── Field extraction ──────────────────────────────────────────────────────────

/**
 * Extract a single form field from an element.
 * B2-SG-005, B2-SG-013, B2-FORM-EXT.
 */
function extractField(fieldEl: HTMLElement, registry: NodeIdRegistry): FormField {
  const fieldTag = fieldEl.tagName.toLowerCase();
  const fieldNodeId = registry.idFor(fieldEl);
  const fieldType = fieldEl.getAttribute("type") ?? undefined;
  const uid = registry.uidFor(fieldEl);

  const field: FormField = {
    tag: fieldTag,
    // Non-null assertion justified: HTMLInputElement.required defaults to false
    required: (fieldEl as HTMLInputElement).required ?? false,
    nodeId: fieldNodeId,
    ...(uid !== undefined ? { uid } : {}),
  };

  if (fieldType !== undefined) field.type = fieldType;

  const fieldName = fieldEl.getAttribute("name");
  if (fieldName !== null && fieldName.length > 0) field.name = fieldName;

  const label = resolveFieldLabel(fieldEl);
  if (label !== undefined) field.label = label;

  // B2-SG-013: password field value must be "[REDACTED]"
  if (fieldType === "password") {
    field.value = "[REDACTED]";
  } else {
    const value = (fieldEl as HTMLInputElement).value;
    if (value !== undefined && value !== null) {
      field.value = value;
    }
  }

  // B2-FORM-EXT: Extract validation state for form control elements
  const isFormControl = fieldEl instanceof HTMLInputElement ||
    fieldEl instanceof HTMLTextAreaElement ||
    fieldEl instanceof HTMLSelectElement;

  if (isFormControl) {
    const el = fieldEl as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const validity = el.validity;
    if (validity) {
      if (!validity.valid) {
        field.validationState = "invalid";
        // HTML5 constraint validation message
        field.validationMessage = el.validationMessage;
      } else if (validity.valueMissing || validity.typeMismatch ||
        validity.patternMismatch || validity.tooLong || validity.tooShort ||
        validity.rangeUnderflow || validity.rangeOverflow || validity.stepMismatch) {
        // Has constraints and they are all satisfied — mark valid
        field.validationState = "valid";
      }
    }

    // B2-FORM-EXT: disabled/readonly state
    if ("disabled" in el) field.disabled = el.disabled;
    if ("readOnly" in el) field.readonly = el.readOnly;

    // B2-FORM-EXT: Extract constraints
    field.constraints = extractConstraints(fieldEl);
  }

  return field;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract form models from the document.
 *
 * B2-SG-005: One FormModel per <form> element.
 * B2-SG-009: Hidden forms (and hidden fields within visible forms) excluded
 *            when visibleOnly is true.
 * B2-SG-013: Password field values redacted.
 * B2-FORM-EXT: validationState, validationMessage, constraints, summary.
 */
export function extractForms(
  registry: NodeIdRegistry,
  visibleOnly: boolean,
): FormModel[] {
  const forms = document.querySelectorAll("form");
  const models: FormModel[] = [];

  for (const formEl of Array.from(forms)) {
    if (!(formEl instanceof HTMLFormElement)) continue;

    // B2-SG-009: skip hidden forms
    if (visibleOnly && isHidden(formEl)) continue;

    const nodeId = registry.idFor(formEl);
    const uid = registry.uidFor(formEl);

    const model: FormModel = {
      nodeId,
      ...(uid !== undefined ? { uid } : {}),
      method: (formEl.method?.toUpperCase() ?? "GET") || "GET",
      fields: [],
    };

    const formId = formEl.getAttribute("id");
    if (formId !== null && formId.length > 0) model.formId = formId;

    const formName = formEl.getAttribute("name");
    if (formName !== null && formName.length > 0) model.name = formName;

    const action = formEl.getAttribute("action");
    if (action !== null && action.length > 0) model.action = action;

    const fieldElements = formEl.querySelectorAll("input, select, textarea, button");
    for (const fieldEl of Array.from(fieldElements)) {
      if (!(fieldEl instanceof HTMLElement)) continue;

      // B2-SG-009: skip hidden fields
      if (visibleOnly && isHidden(fieldEl)) continue;

      model.fields.push(extractField(fieldEl, registry));
    }

    // B2-FORM-EXT: Compute summary counts
    if (model.fields.length > 0) {
      model.summary = {
        total: model.fields.length,
        optional: model.fields.filter((f) => !f.required).length,
        disabled: model.fields.filter((f) => f.disabled === true).length,
      };
    }

    models.push(model);
  }

  return models;
}

/**
 * M113-SEM — Form model extractor.
 */

import type { FormModel } from "./semantic-graph-types.js";
import type { NodeIdRegistry } from "./semantic-graph-helpers.js";
import { isHidden } from "./semantic-graph-helpers.js";
import { extractField } from "./semantic-graph-form-fields.js";

export function extractForms(
  registry: NodeIdRegistry,
  visibleOnly: boolean,
): FormModel[] {
  const forms = document.querySelectorAll("form");
  const models: FormModel[] = [];

  for (const formEl of Array.from(forms)) {
    if (!(formEl instanceof HTMLFormElement)) continue;
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
      if (visibleOnly && isHidden(fieldEl)) continue;
      model.fields.push(extractField(fieldEl, registry));
    }

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

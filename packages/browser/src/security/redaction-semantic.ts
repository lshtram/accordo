import type { RedactionPolicy } from "./security-types.js";
import { redactText } from "./redaction-patterns.js";
import type { SemanticGraphLike } from "./redaction-response-types.js";

type A11yNode = { name?: string; children: A11yNode[] };
type FormField = { label?: string; value?: string; name?: string };

export function redactSemanticGraphResponse(response: SemanticGraphLike, policy: RedactionPolicy): boolean {
  let anyApplied = false;
  for (const node of response.a11yTree ?? []) anyApplied = redactA11yNode(node as A11yNode, policy) || anyApplied;
  for (const landmark of response.landmarks ?? []) anyApplied = redactOptionalText(landmark, "label", policy) || anyApplied;
  for (const heading of response.outline ?? []) anyApplied = redactOptionalText(heading, "text", policy) || anyApplied;
  for (const form of response.forms ?? []) anyApplied = redactForm(form, policy) || anyApplied;
  return anyApplied;
}

function redactA11yNode(node: A11yNode, policy: RedactionPolicy): boolean {
  let anyApplied = redactOptionalText(node, "name", policy);
  for (const child of node.children ?? []) anyApplied = redactA11yNode(child, policy) || anyApplied;
  return anyApplied;
}

function redactForm(form: { name?: string; fields?: FormField[] }, policy: RedactionPolicy): boolean {
  let anyApplied = redactOptionalText(form, "name", policy);
  for (const field of form.fields ?? []) anyApplied = redactFormField(field, policy) || anyApplied;
  return anyApplied;
}

function redactFormField(field: FormField, policy: RedactionPolicy): boolean {
  let anyApplied = false;
  for (const key of ["label", "value", "name"] as const) anyApplied = redactOptionalText(field, key, policy) || anyApplied;
  return anyApplied;
}

function redactOptionalText<T extends string>(obj: Partial<Record<T, string>>, key: T, policy: RedactionPolicy): boolean {
  if (!obj[key]) return false;
  const r = redactText(obj[key], policy);
  obj[key] = r.text;
  return r.redactionApplied;
}

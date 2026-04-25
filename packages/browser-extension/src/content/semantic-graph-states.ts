export function collectElementStates(el: HTMLElement): string[] {
  const states: string[] = [];

  const hasAriaDisabled = el.getAttribute("aria-disabled") === "true";
  const hasAriaReadonly = el.getAttribute("aria-readonly") === "true";
  const hasAriaRequired = el.getAttribute("aria-required") === "true";
  const hasAriaChecked = el.getAttribute("aria-checked") === "true";
  const hasAriaSelected = el.getAttribute("aria-selected") === "true";
  const hasAriaHidden = el.getAttribute("aria-hidden") === "true";

  if (hasAriaDisabled) states.push("disabled");
  if (hasAriaReadonly) states.push("readonly");
  if (hasAriaRequired) states.push("required");
  if (hasAriaChecked) states.push("checked");
  if (hasAriaSelected) states.push("selected");
  if (hasAriaHidden) states.push("hidden");

  if (el instanceof HTMLInputElement) {
    if (el.disabled && !states.includes("disabled")) states.push("disabled");
    if (el.readOnly && !states.includes("readonly")) states.push("readonly");
    if (el.required && !states.includes("required")) states.push("required");
    if (el.checked && !states.includes("checked")) states.push("checked");
  }
  if (el instanceof HTMLTextAreaElement) {
    if (el.disabled && !states.includes("disabled")) states.push("disabled");
    if (el.readOnly && !states.includes("readonly")) states.push("readonly");
    if (el.required && !states.includes("required")) states.push("required");
  }
  if (el instanceof HTMLSelectElement) {
    if (el.disabled && !states.includes("disabled")) states.push("disabled");
    if (el.required && !states.includes("required")) states.push("required");
  }
  if (el instanceof HTMLButtonElement) {
    if (el.disabled && !states.includes("disabled")) states.push("disabled");
  }
  if (el instanceof HTMLOptionElement && el.selected && !states.includes("selected")) {
    states.push("selected");
  }

  const ariaExpanded = el.getAttribute("aria-expanded");
  if (ariaExpanded === "true") states.push("expanded");
  else if (ariaExpanded === "false") states.push("collapsed");
  else if (el instanceof HTMLDetailsElement) states.push(el.open ? "expanded" : "collapsed");

  return states;
}

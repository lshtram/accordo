import type { ElementFilter } from "./page-map-filter-types.js";

export const INTERACTIVE_TAGS: ReadonlySet<string> = new Set([
  "button", "a", "input", "select", "textarea",
]);

export const INTERACTIVE_EVENT_ATTRS: ReadonlySet<string> = new Set([
  "onclick", "onmousedown", "onmouseup", "onpointerdown", "onpointerup",
  "ontouchstart", "ontouchend", "onkeydown", "onkeyup", "onkeypress",
]);

export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "button", "link", "textbox", "combobox", "listbox", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "radio", "checkbox",
  "searchbox", "slider", "spinbutton", "switch", "tab",
]);

export const IMPLICIT_ROLE_MAP: Readonly<Record<string, string>> = {
  a: "link",
  article: "article",
  aside: "complementary",
  button: "button",
  details: "group",
  dialog: "dialog",
  footer: "contentinfo",
  form: "form",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  header: "banner",
  hr: "separator",
  img: "img",
  input: "textbox",
  li: "listitem",
  main: "main",
  menu: "list",
  nav: "navigation",
  ol: "list",
  option: "option",
  output: "status",
  progress: "progressbar",
  section: "region",
  select: "combobox",
  summary: "button",
  table: "table",
  tbody: "rowgroup",
  td: "cell",
  textarea: "textbox",
  tfoot: "rowgroup",
  th: "columnheader",
  thead: "rowgroup",
  tr: "row",
  ul: "list",
};

export function isInViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight || document.documentElement.clientHeight : 768;
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth || document.documentElement.clientWidth : 1024;
  return rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
}

export function isInteractive(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  const role = element.getAttribute("role");
  if (role !== null && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;
  const contentEditable = element.getAttribute("contenteditable");
  if (contentEditable !== null && contentEditable !== "false") return true;
  for (const attr of INTERACTIVE_EVENT_ATTRS) {
    if (element.hasAttribute(attr)) return true;
  }
  return typeof (element as HTMLElement).onclick === "function";
}

export function matchesRoles(roles: readonly string[]): ElementFilter {
  if (roles.length === 0) return () => false;
  const normalised = new Set(roles.map((r) => r.toLowerCase()));
  return (element: Element): boolean => {
    const explicitRole = element.getAttribute("role");
    if (explicitRole !== null) return normalised.has(explicitRole.toLowerCase());
    const implicitRole = IMPLICIT_ROLE_MAP[element.tagName.toLowerCase()];
    return implicitRole !== undefined && normalised.has(implicitRole);
  };
}

export function matchesText(text: string): ElementFilter {
  if (text === "") return () => false;
  const needle = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (needle === "") return () => false;
  return (element: Element): boolean => {
    const content = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    return content.toLowerCase().includes(needle);
  };
}

export function matchesSelector(selector: string): ElementFilter {
  if (selector === "") return () => true;
  try {
    document.createElement("div").matches(selector);
  } catch {
    return () => true;
  }
  return (element: Element): boolean => {
    try {
      return element.matches(selector);
    } catch {
      return true;
    }
  };
}

export function intersectsRegion(
  region: { x: number; y: number; width: number; height: number },
): ElementFilter {
  return (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const regionRight = region.x + region.width;
    const regionBottom = region.y + region.height;
    const elRight = rect.left + rect.width;
    const elBottom = rect.top + rect.height;
    return rect.left < regionRight && elRight > region.x && rect.top < regionBottom && elBottom > region.y;
  };
}

export function hasUsableRegion(
  region: { x: number; y: number; width: number; height: number } | undefined,
): region is { x: number; y: number; width: number; height: number } {
  return region !== undefined && region.width > 0 && region.height > 0;
}

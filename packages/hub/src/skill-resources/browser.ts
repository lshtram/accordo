export const browserSkill = `# Accordo Browser Skill

Use this skill for browser page inspection, tab continuity, screenshots, and browser control actions.

## Read Before Act

1. Use \`accordo_browser_health\` when connection state is uncertain.
2. Use \`accordo_browser_list_pages\` and \`accordo_browser_select_page\` to target the right tab.
3. Use read-only tools first to acquire current page state before clicking or typing.

## Choosing A Read Tool

- \`accordo_browser_get_page_map\`: DOM structure and interactive element references. Use this before clicks/typing.
- \`accordo_browser_get_text_map\`: reading-order visible text.
- \`accordo_browser_get_semantic_graph\`: accessibility tree, headings, landmarks, and forms.
- \`accordo_browser_inspect_element\`: styles, states, visibility, and accessibility details for one element.
- \`accordo_browser_get_dom_excerpt\`: sanitized HTML subtree when tags/structure matter.

## Snapshot Handles

- Snapshot-scoped \`uid\`, \`ref\`, and \`nodeId\` must come from a fresh page map.
- If a tool reports stale or missing snapshot metadata, reacquire \`get_page_map\` and retry with current handles.
- Prefer explicit \`tabId\` when the user may switch tabs during the task.

## Control Actions

- \`accordo_browser_navigate\`, \`click\`, \`type\`, and \`press_key\` require user-granted browser control.
- If you receive \`control-not-granted\`, ask the user to grant control in the Accordo browser extension popup, then retry.
- For forms, inspect fields or use semantic graph before typing.

## Screenshots And Redaction

- Prefer structured page tools over screenshots when text/DOM data is enough.
- Use \`accordo_browser_capture_region\` for visual verification or cropped evidence.
- Screenshot redaction is not OCR-complete; do not assume image-only PII is removed.

## Common Recovery

- \`browser-not-connected\`: ask user to pair/reconnect the extension.
- \`no-target\` or \`tab-not-found\`: list/select pages or pass explicit \`tabId\`.
- \`element-not-found\`: reacquire page map and retry with current selector/uid.
- \`origin-blocked\`: only relax origin filters when appropriate for the task.
`;

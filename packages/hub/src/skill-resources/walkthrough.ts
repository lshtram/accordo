export const walkthroughSkill = `# Accordo Walkthrough Skill

Use this skill for narrated demos, presentation shows, code-review walkthroughs, and guided UI tours.

## Universal Sequence

Use reveal -> wait -> highlight -> narrate.

1. Reveal the file, slide, browser page, terminal, or diagram.
2. Wait briefly for rendering.
3. Highlight or focus the relevant area.
4. Narrate after the user can see the subject.

## Panel Hygiene

Close distracting panels before starting a guided walkthrough:

\`\`\`json
{ "tool": "accordo_layout_panel", "arguments": { "area": "sidebar", "action": "close" } }
{ "tool": "accordo_layout_panel", "arguments": { "area": "panel", "action": "close" } }
\`\`\`

## A. Present Topics

- Use \`accordo://skills/presentation\` to create/open the deck.
- Generate all narration in one call.
- Move slide-by-slide with \`accordo_presentation_goto\`, then speak the matching narration with \`accordo_voice_readAloud\`.

## B. Code Reviews

- Start with findings ordered by severity.
- For each finding, open the relevant file with \`accordo_editor_open({ path, line })\`.
- Highlight the exact range with \`accordo_editor_highlight\`.
- Narrate the finding only after the code is visible.
- Clear highlights before moving to the next finding.
- Optionally create a short deck for stakeholder-friendly summary, but keep source files as the evidence surface.

## C. Feature Walkthroughs And Demos

- Show live UI state changes rather than describing them abstractly.
- Use terminal readback when terminal output is part of the demo.
- Use browser page maps before browser control actions.
- Use comments or highlights to anchor discussion when reviewing artifacts.

## External Script Runner

For repeatable demos, author a NarrationScript JSON and run it through the external Python runner:

\`\`\`bash
python skills/script-authoring/accordo-run.py --script demo.json
\`\`\`
`;

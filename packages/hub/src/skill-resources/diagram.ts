export const diagramSkill = `# Accordo Diagram Skill

Use this skill for Mermaid/Accordo diagrams, flowcharts, architecture visuals, and rendered diagram exports.

## Critical Rules

- Mermaid \`classDef\` and \`style\` directives are ignored by Accordo rendering.
- Apply all rendered styling through \`accordo_diagram_patch\` using \`nodeStyles\` and \`edgeStyles\`.
- Use Mermaid \`\\n\` inside quoted labels for line breaks. Do not use \`<br/>\`.

## Workflow

1. Create the \`.mmd\` file with \`accordo_diagram_create\`.
2. Open it with \`accordo_editor_open\` if the user should see it.
3. Apply styles with \`accordo_diagram_patch\`.
4. Render/export with \`accordo_diagram_render\` when an image artifact is needed.

## Styling Example

\`\`\`json
{
  "tool": "accordo_diagram_patch",
  "arguments": {
    "path": "docs/architecture.mmd",
    "content": "flowchart TD\\n  A[Agent] --> B[Hub]",
    "nodeStyles": {
      "A": { "backgroundColor": "#D4E8F5", "strokeColor": "#1A5276", "fontColor": "#1A5276" },
      "B": { "backgroundColor": "#D5F5E3", "strokeColor": "#1E8449", "fontColor": "#1E8449" }
    },
    "edgeStyles": {
      "A->B:0": { "strokeColor": "#1A5276", "strokeWidth": 2 }
    }
  }
}
\`\`\`

## Style Fields

- Node style fields: \`backgroundColor\`, \`strokeColor\`, \`strokeWidth\`, \`strokeStyle\`, \`fillStyle\`, \`opacity\`, \`fontColor\`, \`fontSize\`, \`fontFamily\`, \`fontWeight\`, \`width\`, \`height\`, \`x\`, \`y\`.
- Edge style fields: \`strokeColor\`, \`strokeWidth\`, \`strokeStyle\`, \`strokeDash\`, \`routing\`.
- Edge keys use \`source->target:index\`, for example \`A->B:0\`.

## Palette Guidance

Use dark text on light backgrounds. Common pairs:

- Blue: fill \`#D4E8F5\`, stroke/text \`#1A5276\`.
- Green: fill \`#D5F5E3\`, stroke/text \`#1E8449\`.
- Yellow: fill \`#FEF9E7\`, stroke/text \`#B7950B\`.
- Purple: fill \`#E8E0F0\`, stroke/text \`#4A3080\`.
`;

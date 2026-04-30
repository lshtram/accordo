export const presentationSkill = `# Accordo Presentation Skill

Use this skill for Marp decks, slide navigation, narration generation, and webview capture.

## Deck Basics

- Decks are Markdown files with \`marp: true\` frontmatter.
- Slide numbers in Accordo presentation tools are 1-based.
- Open a deck with \`accordo_presentation_open({ deckUri })\` before navigation or capture.

## Core Workflow

1. Create or update the deck Markdown file.
2. Open with \`accordo_presentation_open\`.
3. Use \`accordo_presentation_getCurrent\` to verify active slide.
4. Navigate with \`accordo_presentation_goto\`.
5. Generate narration with \`accordo_presentation_generateNarration\`.
6. Capture visible slide with \`accordo_webview_capture\` when an SVG artifact is needed.

## Marp Frontmatter

\`\`\`markdown
---
marp: true
theme: accordo-dark
paginate: true
size: 16:9
---
\`\`\`

## Narration

- Call \`accordo_presentation_generateNarration\` once without \`slideIndex\` to generate narration for all slides.
- Use per-slide generation only when refreshing a changed slide.

## Capture

- Prefer an explicit \`output_path\` for \`accordo_webview_capture\` to avoid ambiguous artifact placement.
- Verify capture output size/content when fidelity matters.
`;

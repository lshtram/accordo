export const presentationSkill = `# Accordo Presentation Skill

Use this skill for Marp decks, slide navigation, and narration generation.

## Deck Basics

- Decks are Markdown files with \`marp: true\` frontmatter.
- Slide numbers in Accordo presentation tools are 1-based.
- Open a deck with \`accordo_presentation_open({ deckUri })\` before navigation.

## Core Workflow

1. Create or update the deck Markdown file.
2. Open with \`accordo_presentation_open\`.
3. Use \`accordo_presentation_getCurrent\` to verify active slide.
4. Navigate with \`accordo_presentation_goto\`.
5. Generate narration with \`accordo_presentation_generateNarration\`.

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

`;

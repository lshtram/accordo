# Presentations Skill

A self-contained AI agent skill for creating polished [Slidev](https://sli.dev) presentations
from any topic, document, or conversation.

## Contents

```
presentations/
  skill.md                         ← Agent instructions (load this)
  README.md                        ← This file
  knowledge/
    slidev-reference.md            ← Complete Slidev syntax reference
    presentation-templates.md      ← Copy-paste deck templates
    visual-transformation-guide.md ← How to turn text into visuals
  scripts/
    scaffold-deck.mjs              ← Scaffold a new deck from a template
    validate-deck.mjs              ← Validate a deck before presenting
```

## Quick Start

### 1. Install Slidev (once per project)

```bash
npm install -D @slidev/cli
# or
pnpm add -D @slidev/cli
```

### 2. Install a theme (optional)

Slidev's `default` theme is always available with no install needed.
To use a richer theme, install it as a dev dependency:

```bash
# Elegant serif — recommended
npm install -D @slidev/theme-seriph

# Apple keynote feel
npm install -D @slidev/theme-apple-basic

# Bold and colorful
npm install -D @slidev/theme-bricks
```

Then set `theme: seriph` (or your chosen theme) in the deck frontmatter.

### 3. Scaffold a new deck

```bash
# Types: overview, walkthrough, sprint, rfc, explainer
node skills/presentations/scripts/scaffold-deck.mjs overview my-talk.deck.md "My System"
```

### 4. Validate before presenting

```bash
node skills/presentations/scripts/validate-deck.mjs my-talk.deck.md
```

### 5. Open in VS Code / Accordo

Use the `accordo_presentation_open` MCP tool, or open the `.deck.md` file directly
in VS Code with the Slidev extension installed.

## Copying to Another Project

This skill is self-contained. Copy the entire `skills/presentations/` folder.
Then install dependencies in the target project:

```bash
npm install -D @slidev/cli @slidev/theme-seriph
```

If you use `theme: default` in your deck frontmatter, no extra theme install is needed.

## Skill Format

`skill.md` follows the industry-standard skill format (YAML frontmatter + markdown body)
used by Anthropic Claude, OpenAI Assistants, and Cursor agent rules:

```yaml
---
id: accordo-presentations
version: 1.0.0
tags: [slidev, presentations]
knowledge:
  - knowledge/slidev-reference.md
  - knowledge/presentation-templates.md
  - knowledge/visual-transformation-guide.md
scripts:
  - scripts/validate-deck.mjs
  - scripts/scaffold-deck.mjs
---
```

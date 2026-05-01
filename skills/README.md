# Accordo IDE — Skills Index

This directory contains project-specific skills for the Accordo IDE agent.

## Available Skills

| Skill ID | Purpose | When to Load |
|----------|---------|--------------|
| `accordo` | General Accordo MCP editor/layout/terminal/comment workflows | Any general Accordo tool-use task |
| `accordo-diagrams` | Create and edit Mermaid diagrams with Accordo styling | Diagram-related tasks |
| `accordo-presentations` | Create Marp presentations with narration | Presentation/slide tasks |
| `accordo-script-authoring` | Author demo scripts via external Python runner (NarrationScript format, `accordo-run.py`) | Script/narration tasks |
| `accordo-vscode-command-gateway` | Use the generic VS Code command catalog/execute escape hatch safely | Long-tail VS Code command workflows |
| `debugging` | Systematic 5-phase debugging process | Bug investigation, test failures |

## How to Use Skills

When working on a relevant task, load the skill using:

```
skill: accordo
skill: accordo-diagrams
skill: accordo-presentations
skill: accordo-script-authoring
skill: accordo-vscode-command-gateway
skill: debugging
```

### Mandatory pairing rules

- For **presentation authoring only**: load `accordo-presentations`.
- For **narrated presentation-show / scripted walkthrough**: load **both** `accordo-presentations` and `accordo-script-authoring`.
- For any scripted demo/narration request, use NarrationScript + `python skills/script-authoring/accordo-run.py`.

## Skill Structure

Each skill contains:
- **YAML frontmatter** — `id`, `version`, `tags`, `knowledge` references
- **When to Use** — triggers for loading the skill
- **Procedural content** — step-by-step guides, MCP tools reference, templates
- **Anti-patterns** — common mistakes to avoid

## Creating New Skills

1. Create `skills/<skill-name>/skill.md`
2. Add YAML frontmatter with `id`, `version`, `author`, `tags`, `knowledge`
3. Write the skill content following the pattern of existing skills
4. Add knowledge files in `skills/<skill-name>/knowledge/`

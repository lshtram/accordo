# Marp Reference — Agent Knowledge

> Complete reference for creating beautiful Marp presentations.
> Marp converts Markdown to slides. Each `---` separator = new slide.

---

## 1. Frontmatter

Every deck starts with a YAML block. `marp: true` activates the engine.

```markdown
---
marp: true
theme: accordo-dark
paginate: true
size: 16:9
header: "My Company"
footer: "Confidential · March 2026"
---
```

**Global directives (in frontmatter):**
| Directive | Values | Effect |
|-----------|--------|--------|
| `theme` | `accordo-dark`, `accordo-corporate`, `accordo-light`, `accordo-gradient`, `default`, `gaia`, `uncover` | Slide theme |
| `paginate` | `true` / `false` | Show page numbers |
| `size` | `16:9` (1280×720), `4:3` (960×720) | Aspect ratio |
| `header` | string | Header text on all slides |
| `footer` | string | Footer text on all slides |
| `style` | inline CSS | Custom CSS overrides |

---

## 2. Available Themes

### Built-in Marp Themes
- **`default`** — GitHub markdown style, light, clean
- **`gaia`** — Classic Marp design with purple tones; supports `lead`, `gaia`, `invert` classes
- **`uncover`** — Minimal, modern, reveal.js-inspired

### Accordo Custom Themes
Dark, rich, professional — carefully crafted for the VS Code environment.

| Theme | Style | Best For |
|-------|-------|---------|
| `accordo-dark` | GitHub dark, electric blue accents | Technical docs, code walkthroughs |
| `accordo-corporate` | Dark navy, teal/gold accents, subtle gradients | Business pitches, enterprise |
| `accordo-light` | Clean white, blue accents | Teaching, documentation, reports |
| `accordo-gradient` | Vibrant gradient backgrounds | Creative, marketing, talks |

### Accordo Gradient Color Classes
Apply to individual slides with `<!-- _class: <name> -->`:
```
ocean    — deep blue gradient
sunset   — orange/pink/red gradient
forest   — green gradient
midnight — dark blue gradient
rose     — red/orange gradient
emerald  — green/teal gradient
aurora   — deep dark gradient
```

---

## 3. Per-Slide Directives

Use HTML comment syntax. A `_` prefix applies only to that slide.

```markdown
<!-- _class: lead -->        ← title/cover slide (centered, impactful)
<!-- _class: section -->     ← section divider
<!-- _class: invert -->      ← inverted colors
<!-- _class: lead ocean -->  ← combine classes (lead + ocean color)
<!-- _paginate: false -->    ← hide page number this slide only
<!-- _header: "" -->         ← hide header this slide only
<!-- _footer: "" -->         ← hide footer this slide only
<!-- _backgroundColor: #222 --> ← custom bg color (no theme needed)
<!-- _color: white -->       ← custom text color
```

**Persistent** (no underscore — applies to all slides from here):
```markdown
<!-- paginate: true -->
<!-- header: "Chapter 2" -->
```

---

## 4. Image Syntax

Marp extends standard Markdown image syntax with keywords in the alt text.

### Background Images
```markdown
![bg](./photo.jpg)                  ← full background (default: cover)
![bg cover](./photo.jpg)            ← cover (fill, crop to fit)
![bg contain](./photo.jpg)          ← contain (letterbox, no crop)
![bg 70%](./photo.jpg)              ← scale to 70% of slide
![bg right](./photo.jpg)            ← right half background
![bg right:40%](./photo.jpg)        ← right 40% background
![bg left](./photo.jpg)             ← left half background
![bg vertical](./photo.jpg)         ← stacked with next bg image
```

### Inline Images
```markdown
![center](./diagram.png)            ← horizontally centered
![right](./icon.png)                ← float right
![left w:200px](./logo.png)         ← float left, fixed width
![w:400px h:300px](./chart.png)     ← exact dimensions
![w:90%](./wide.png)                ← percentage width
```

### Two-Column Layout with Background Split
```markdown
---
![bg right:45%](./image.jpg)

# Content on the Left

- Point one
- Point two
```

---

## 5. Typography and Structure

### Make Text Fit — Fitting Header
Add `<!-- fit -->` after `#` to make a heading fill the slide width:
```markdown
# <!-- fit --> ENORMOUS TITLE
```

### Emphasis Styles
```markdown
**bold text**
*italic text*
~~strikethrough~~
`inline code`
==highlight== (if supported)
```

### Columns — HTML trick
Marp doesn't have columnar layouts natively, but you can use HTML:
```html
<div style="display:grid;grid-template-columns:1fr 1fr;gap:2em">
<div>

### Left Column
- item 1
- item 2

</div>
<div>

### Right Column
- item 3
- item 4

</div>
</div>
```

### Custom Styling Per Slide — Inline Style
```markdown
<style scoped>
section { font-size: 22px; }
h1 { color: #ff6600; }
</style>
```

---

## 6. Speaker Notes

Add a comment block at the bottom of a slide:
```markdown
# Slide Title

Content here

<!-- notes
Speaker notes go here. These are visible to the presenter
but not in the rendered slide view.
Not visible to the audience.
-->
```
Or use the `<!-- speaker_notes -->` separator (same effect).

When calling `accordo_presentation_generateNarration`, this content is used as the base for the narration text.

---

## 7. Math and Diagrams

### KaTeX Math
```markdown
Inline: $E = mc^2$

Block:
$$
\sum_{i=1}^{n} x_i = \bar{x} \cdot n
$$
```

### Code Blocks
Standard fenced code blocks with syntax highlighting:
````markdown
```typescript
const fn = (x: number): string => x.toString();
```
````

---

## 8. Pagination and Navigation

When `paginate: true` is set, each slide shows `N / Total` in the bottom corner.

To hide pagination on the first slide (common pattern):
```markdown
---
marp: true
paginate: true
---

<!-- _paginate: false -->
# Cover Slide — No page number here

---

# Slide 2 — Page numbers resume here
```

---

## 9. Design Principles for Beautiful Slides

### One Idea Per Slide
- Don't cram. A slide should have ONE main message.
- If you have 5 sub-points, consider 5 slides.

### Hierarchy
- `h1` = slide title (one per slide)
- `h2` = section within slide (use sparingly)
- `h3` = category label (good for grid/card patterns)
- Body text = supporting detail (keep short)

### Color Usage
- Accent color = **one thing only** — the most important element
- Use `_class: invert` for impact moments
- Use `_class: section` for chapter breaks
- Use `_class: lead` for title/cover slide

### Visual Density
- Ideal: 3–5 bullet points max per slide
- For heavy content: use `<!-- _class: tinytext -->` built-in helper (scales text to 65%  of normal size inside some themes) — or add `<style scoped>section{font-size:22px}</style>`

### Images
- Use `![bg right:40%]` for content+image side-by-side (very effective)
- Use `![bg](url)` with colored overlay for sections: set `_backgroundColor` with 80% opacity
- Use `![center w:80%]` for diagrams that need to breathe

### Quotes for Impact
```markdown
> "The measure of intelligence is the ability to change."
> — Albert Einstein
```
Blockquotes render with a left accent bar — great for pull quotes.

---

## 10. Complete Slide Catalog

### Cover / Title Slide
```markdown
---
<!-- _class: lead -->

# Project Phoenix
## Rebuilding the Core Platform

*Engineering All-Hands · March 2026*
```

### Section Divider
```markdown
---
<!-- _class: section -->

# Part II
## Architecture Deep Dive
```

### Agenda / Table of Contents
```markdown
---
# Agenda

1. **Problem** — What we're solving
2. **Approach** — How we're solving it
3. **Progress** — Where we are
4. **Next Steps** — What's next
```

### Key Message Emphasis
```markdown
---
<!-- _class: invert -->

# The Core Insight

> This changes how we think about every decision we make.
```

### Stat / Number Highlight
```markdown
---
# By the Numbers

<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2em;margin-top:1em;text-align:center">
<div>
### 98%
Uptime SLA
</div>
<div>
### 3×
Faster deploys
</div>
<div>
### 40%
Cost reduction
</div>
</div>
```

### Content + Image Split
```markdown
---
![bg right:42%](./architecture.png)

# System Overview

- Microservice architecture
- Event-driven communication
- PostgreSQL + Redis data layer
- Kubernetes on GKE
```

### Code Walkthrough
````markdown
---
# Core Algorithm

```typescript
async function processEvent(event: DomainEvent) {
  const handler = registry.get(event.type);
  if (!handler) throw new UnknownEventError(event.type);
  return handler.execute(event.payload);
}
```

- `registry` is injected — fully testable
- `handler.execute` is async — non-blocking
````

### Comparison Table
```markdown
---
# Before vs After

| | Before | After |
|---|---|---|
| Deploy time | 45 min | 8 min |
| Error rate | 2.3% | 0.1% |
| P99 latency | 800ms | 120ms |
| Test coverage | 34% | 91% |
```

### Timeline / Process Steps
```markdown
---
# Rollout Plan

### Week 1 — Foundation
Set up CI pipeline, migrate schemas, deploy to staging

### Week 2 — Migration
Dual-write mode, validate parity, monitor metrics

### Week 3 — Cutover
Blue-green switch, decommission old service, celebrate 🎉
```

---

## 11. Accordo Gradient Theme — Class Reference

The `accordo-gradient` theme includes color variant classes for visual variety:

```markdown
<!-- _class: lead -->       Deep night sky (dark blue-black)
<!-- _class: section -->    Sunset (pink/red/orange) — chapter divider
<!-- _class: ocean -->      Deep sea blue
<!-- _class: forest -->     Green nature gradient
<!-- _class: midnight -->   Classic dark blue
<!-- _class: rose -->       Red/orange energy
<!-- _class: emerald -->    Teal/green fresh
<!-- _class: aurora -->     Very dark atmospheric
```

---

## 12. Common Mistakes

| Mistake | Fix |
|---------|-----|
| Forgetting `marp: true` | Add to frontmatter |
| Slide separator `---` must be on its own line | Don't put content on same line |
| Images not showing | Use absolute paths or relative to deck file location |
| Text overflowing slide | Reduce font with `<style scoped>` or split into more slides |
| `_class` not applying | Must be `<!-- _class: name -->` with exact spacing |
| Background image too dark/light | Add CSS: `section::before { background: rgba(0,0,0,0.4); }` overlay trick |

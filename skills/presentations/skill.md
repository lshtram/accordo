---
id: accordo-presentations
version: 2.0.0
author: Accordo IDE
tags: [marp, presentations, visual, deck, slides, markdown]
knowledge:
  - knowledge/marp-reference.md
  - knowledge/marp-templates.md
  - knowledge/visual-transformation-guide.md
scripts:
  - scripts/validate-deck.mjs
  - scripts/scaffold-deck.mjs
---

# Skill: Create Marp Presentations

---

## Description

This skill enables an AI agent to transform any topic, document, or conversation
into a polished **Marp** presentation rendered directly inside VS Code via the
Accordo MCP tools. The agent can create decks from scratch, convert content into
visual slides, and control the live presentation.

**Engine:** Marp (Markdown Presentation Ecosystem)  
**Format:** `.md` files with `marp: true` frontmatter  
**Themes available:** `accordo-dark`, `accordo-corporate`, `accordo-light`, `accordo-gradient` (plus built-ins: `default`, `gaia`, `uncover`)

---

## When to Use This Skill

- User says "present", "make a deck", "create slides", "show me"
- Summarising a topic, architecture, proposal, or walkthrough visually
- Sprint reviews, project overviews, code walkthroughs, pitches
- User mentions "marp", "presentation", "deck", or "slides"

---

## Quick Start — Create and Present a Deck

```
1. Pick or create a .md file with marp: true frontmatter
2. Call accordo_presentation_open with the absolute path
3. Navigate with accordo_presentation_next / prev / goto
4. Edit the .md file — the webview auto-reloads on save
```

---

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `accordo_presentation_discover` | List `.md` deck files in workspace |
| `accordo_presentation_open` | Open a deck and start the Marp viewer |
| `accordo_presentation_close` | Close the presentation |
| `accordo_presentation_listSlides` | Get all slides (1-based index, title, notes) |
| `accordo_presentation_getCurrent` | Get current slide number (1-based) and title |
| `accordo_presentation_goto` | Jump to slide by **1-based** number |
| `accordo_presentation_next` | Advance one slide |
| `accordo_presentation_prev` | Go back one slide |
| `accordo_presentation_generateNarration` | Generate speaker notes for a slide or all |

> **Index convention:** all slide numbers are **1-based**. Slide 1 is the first slide.

---

## Knowledge Files

| File | Purpose | When to Read |
|------|---------|-------------|
| `knowledge/marp-reference.md` | Complete Marp syntax, directives, themes, image tricks | Always — primary reference |
| `knowledge/marp-templates.md` | Copy-paste deck templates for common scenarios | When starting a new deck |
| `knowledge/visual-transformation-guide.md` | How to turn text/data into visual slides | When converting existing content |

---

## Procedure: Create a Presentation from Topic

### Step 1 — Determine the Presentation Type

Map the user's request to one of these templates:

| User Intent | Template | Slides |
|-------------|----------|--------|
| Architecture, system intro, proposal | Technical Overview | 7-10 |
| Code review, API demo, library intro | Code Walkthrough | 5-7 |
| Sprint review, progress update | Sprint Review | 5-6 |
| Decision, RFC, tech evaluation | RFC / Decision | 6-7 |
| Teaching, onboarding, knowledge share | Concept Explainer | 6-8 |
| General / custom | Start from Technical Overview, adapt | 6-10 |

### Step 2 — Gather Content

Collect the raw material:
- Read relevant source files, docs, or conversation context
- Identify 3-7 key points (this becomes your slide count)
- Note any numbers, metrics, or comparisons (these become hero stats or tables)
- Identify any architecture or relationships (these become Mermaid diagrams)

### Step 3 — Apply Visual Transformations

Consult `knowledge/visual-transformation-guide.md` (co-located in this skill) and apply:

| Content Type | Visual Treatment |
|-------------|------------------|
| Bullet points | Plain list with emoji anchors — **no `<v-clicks>`** |
| Numbers/metrics | Hero stat grid (`text-5xl font-bold`) |
| Comparisons | `layout: two-cols` or table with ✅/❌ |
| Architecture | Mermaid `graph TB` or `graph LR` |
| Process/steps | Mermaid `graph LR` or numbered plain list |
| Categories | Feature card grid (`grid grid-cols-2`) |
| Definitions | `layout: center` + blockquote |
| Trade-offs | Table with colored emoji (🟢🟡🔴) |

### Step 4 — Write the Deck File

1. Create the file as `[topic].deck.md` in the workspace root or `demo/` folder
2. Start with the frontmatter block:

```yaml
---
title: "[Title]"
theme: seriph          # or: default, apple-basic, bricks
colorSchema: dark      # dark recommended for code-heavy
transition: slide-left # or: fade, slide-up
layout: cover
background: https://images.unsplash.com/photo-[ID]?w=1920
---
```

3. Write each slide separated by `---`
4. Add `<!-- notes -->` with speaker talking points and timing on every slide
5. **Do NOT use `<v-clicks>`** — the agent navigates slide-by-slide; click-animated items start hidden and cannot be stepped through. All content must be visible immediately when the slide loads.
6. Verify slide count matches target (see Step 1 table)

#### Content Fitting Rules

> Slides render at a fixed 980×552 canvas. Content that overflows is clipped — the viewer cannot scroll.

- **Mermaid scale**: Always use `{scale: N}`. Simple (2–4 nodes): `0.85`. Medium (5–8 nodes): `0.65`. Complex / subgraphs (9+ nodes): `0.45`. Sequence diagrams: `0.65`.
- **Dense slides**: Add `class: text-sm` to the per-slide frontmatter to reduce font size ~15%.
- **Max 5 items**: No more than 5 bullet points or table rows (excl. header) per slide. Split into two slides if needed.
- **Compact grids**: Use `gap-3 mt-6 p-4` instead of `gap-6 mt-12 p-6` when fitting 4+ cards.
- **`two-cols`**: Keep each column to ≤4 short lines. The column height is half the slide.

### Step 5 — Quality Checklist

Before presenting to the user, verify:

- [ ] Every slide has `<!-- notes -->` with speaker notes
- [ ] **No `<v-clicks>`** — all content visible immediately (agent can't step through animations)
- [ ] At least one Mermaid diagram or visual element exists
- [ ] No slide has more than 5 visible items/lines
- [ ] Every Mermaid diagram has an explicit `{scale: N}` attribute
- [ ] Cover slide has a background image
- [ ] Emoji anchors on bullet points
- [ ] Consistent color coding (blue=info, green=success, amber=warning, red=error)
- [ ] Total slide count is in the 5-10 range (not too many, not too few)

### Step 6 — Open and Present

```
1. Use accordo_presentation_open with the deck file path
2. Use accordo_presentation_listSlides to verify structure
3. Navigate with goto/next/prev as needed
4. Optionally use generateNarration for AI-generated talking points
```

> **Tip:** Validate the deck before opening:
> `node skills/presentations/scripts/validate-deck.mjs <path-to-deck.md>`

---

## Procedure: Convert Existing Document to Slides

### Step 1 — Read the Source Document

Read the full document. Identify:
- **Thesis** → becomes the cover slide subtitle
- **Major sections** → become individual slides
- **Key data points** → become hero stats or tables
- **Relationships** → become Mermaid diagrams

### Step 2 — Outline the Deck

Create a slide outline before writing any markdown:

```
Slide 1: Cover — [title] + [one-line thesis]
Slide 2: Agenda — 4-5 section titles as a plain numbered list
Slide 3: [Section 1] — [visual type: diagram/stats/bullets]
Slide 4: [Section 2] — [visual type]
...
Slide N: Key Takeaways — 3 bullet summary
Slide N+1: End — thank you / questions
```

### Step 3 — Apply Transformations

For each slide in the outline, consult the Pattern Recognition Table in
`visual-transformation-guide.md` and select the best visual treatment.

### Step 4 — Write, Check, Open

Follow Steps 4-6 from the "Create from Topic" procedure above.

---

## Procedure: Quick Single-Slide Addition

When adding a slide to an existing deck:

1. Read the existing deck to understand theme and style
2. Determine where the new slide should go (after which slide index)
3. Write the slide content matching the existing style
4. Insert it at the correct `---` separator position
5. Use `accordo_presentation_listSlides` to verify

---

## Deck Format Quick Reference

```markdown
---
title: "My Presentation"
theme: seriph
colorSchema: dark
transition: slide-left
layout: cover
background: https://cover.sli.dev
---

# Title Slide

Subtitle text

<!-- notes -->
Speaker notes here. (~30 sec)

---
transition: fade
---

# Second Slide

- 🔵 Point 1
- 🟢 Point 2
- 🟡 Point 3

<!-- notes -->
Talking points. (~2 min)

---
layout: two-cols
---

# Comparison

::left::

### Option A
- Pro
- Con

::right::

### Option B
- Pro
- Con

---
layout: center
---

# Diagram

```mermaid
graph LR
  A --> B --> C
`` `

---
layout: end
---

# Thank You
```

---

## Available Themes

| Theme | Style | Best For |
|-------|-------|----------|
| `default` | Clean, minimal | Code walkthroughs, technical |
| `seriph` | Elegant serif fonts | Overviews, proposals, talks |
| `apple-basic` | Apple keynote feel | Product demos, pitches |
| `bricks` | Bold, colorful | Creative, non-technical |

Install community themes with `pnpm add slidev-theme-[name]`.

---

## Available Layouts

| Layout | Use For |
|--------|---------|
| `cover` | Title / first slide |
| `center` | Diagrams, definitions, hero stats |
| `default` | Standard content |
| `two-cols` | Comparisons, before/after |
| `image-right` / `image-left` | Content + image |
| `section` | Section dividers |
| `quote` | Quotes and testimonials |
| `fact` | Single key fact |
| `end` | Final slide |
| `full` | Full-bleed content |

---

## Image Sources

| Source | URL | Use |
|--------|-----|-----|
| Slidev Covers | `https://cover.sli.dev` | Random cover backgrounds |
| Unsplash Collection | `https://unsplash.com/collections/94734566/slidev` | Curated tech photos |
| Direct Unsplash | `https://images.unsplash.com/photo-{ID}?w=1920` | Specific photos |

---

## Examples

### Example: Architecture Overview in 3 Slides

```markdown
---
title: "System Architecture"
theme: seriph
colorSchema: dark
transition: slide-left
layout: cover
background: https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920
---

# System Architecture

An overview of our microservices platform

<!-- notes -->
Quick tour of how our system is structured. (~30 sec)

---
layout: center
class: text-sm
---

# High-Level View

```mermaid {scale: 0.5}
graph TB
  subgraph Clients
    Web[Web App]
    Mobile[Mobile App]
  end
  subgraph Gateway
    API[API Gateway]
  end
  subgraph Services
    Auth[Auth Service]
    Users[User Service]
    Orders[Order Service]
  end
  subgraph Data
    DB[(PostgreSQL)]
    Cache[(Redis)]
  end
  Web & Mobile --> API
  API --> Auth & Users & Orders
  Users & Orders --> DB
  Orders --> Cache
`` `

<!-- notes -->
Three layers: clients, services, data. Gateway handles routing and auth. (~2 min)

---

# Key Metrics

<div class="grid grid-cols-3 gap-8 mt-12 text-center">
  <div>
    <div class="text-6xl font-bold text-blue-400">12ms</div>
    <div class="text-sm mt-3 opacity-60">P50 Latency</div>
  </div>
  <div>
    <div class="text-6xl font-bold text-emerald-400">99.99%</div>
    <div class="text-sm mt-3 opacity-60">Uptime</div>
  </div>
  <div>
    <div class="text-6xl font-bold text-amber-400">50K</div>
    <div class="text-sm mt-3 opacity-60">Requests/sec</div>
  </div>
</div>

<!-- notes -->
These are our current production numbers. (~1 min)
```

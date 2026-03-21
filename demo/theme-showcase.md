---
marp: true
theme: accordo-dark
paginate: true
size: 16:9
footer: "Accordo IDE · Theme Showcase"
---

<!-- _class: lead -->
<!-- _paginate: false -->

# Accordo Themes
## Beautiful Marp Presentations, Built-in

*Four themes · Dozens of layout patterns*

---

# accordo-dark — Default Slide

This is the default slide layout with `accordo-dark`.

- **Primary accent** in headings and borders
- Soft purple for `h2` — adds hierarchy without noise
- Warm orange for `h3` — draws the eye to categories
- Code and blockquotes styled for technical content

> Great for engineering talks, architecture reviews, and anything technical.

---

# Code Example

```typescript
// Theme loading is automatic — just set `theme:` in frontmatter
const renderer = new MarpRenderer();
renderer.render(`
---
marp: true
theme: accordo-dark
---
# My Slide
`);
```

All four themes are bundled into the extension — no internet required.

---

# Tables

| Theme | Style | Font Weight | Best For |
|-------|-------|-------------|---------|
| `accordo-dark` | GitHub dark | Bold h1, lighter h2 | Technical |
| `accordo-corporate` | Navy gradient | Left border h1 | Business |
| `accordo-light` | White clean | Underlined h1 | Teaching |
| `accordo-gradient` | Vivid gradient | Heavy, shadowed | Creative |

---

<!-- _class: section -->

# Part II
## Layout Patterns

---

# Content + Image Split

![bg right:42% contain](https://via.placeholder.com/600x400/1a1a2e/58a6ff?text=Your+Image)

### Right-side images work great

Use `![bg right:40%](path)` to split the slide — content on the left, image on the right.

- Keep bullets short and punchy
- 3–4 points maximum
- Let the image carry meaning too

---

# Stat Highlight Grid

<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2em;text-align:center;margin-top:1.5em">
<div>

### 226 / 226
Tests passing

</div>
<div>

### 4
Custom themes

</div>
<div>

### 1-based
Slide indexing

</div>
</div>

---

# Blockquote for Impact

> "Any sufficiently advanced technology is indistinguishable from magic."

— Arthur C. Clarke

A single well-chosen quote on an `invert` or plain slide lands harder than a bullet list.

---

<!-- _class: invert -->

# Invert for Emphasis

Use `<!-- _class: invert -->` when you want a moment of contrast — a key insight, a call to action, or a chapter break that demands attention.

---

<!-- _paginate: false -->

# End

*Open `demo/theme-showcase-corporate.md` to see `accordo-corporate`.*
*Open `demo/theme-showcase-light.md` to see `accordo-light`.*
*Open `demo/theme-showcase-gradient.md` to see `accordo-gradient`.*

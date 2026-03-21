/**
 * accordo-marp — Built-in Custom Themes
 *
 * All themes are self-contained CSS strings. They are loaded into the Marp
 * themeSet before each render, making them available via `theme:` frontmatter.
 *
 * Available themes:
 *   accordo-dark       Dark professional (GitHub-inspired, technical)
 *   accordo-corporate  Dark navy with gradient accents (business/enterprise)
 *   accordo-light      Clean white minimal (documents, teaching)
 *   accordo-gradient   Vibrant color gradients (creative, marketing)
 *
 * Each theme supports:
 *   - section.lead      Title / cover slide (centered, impactful)
 *   - section.section   Section divider slide
 *   - section.invert    Inverted accent color scheme
 *   - img[alt~="center"] Center an image
 *   - img[alt~="right"]  Float image right
 *   - paginate: true    Shows page numbers via section::after
 */

// ─────────────────────────────────────────────────────────────────────────────
// ACCORDO DARK
// ─────────────────────────────────────────────────────────────────────────────
export const ACCORDO_DARK = `
/**
 * @theme accordo-dark
 * @auto-scaling true
 * @size 16:9 1280px 720px
 * @size 4:3 960px 720px
 */

:root {
  --bg:           #0d1117;
  --bg-elevated:  #161b22;
  --bg-subtle:    #21262d;
  --border:       #30363d;
  --text:         #e6edf3;
  --text-muted:   #8b949e;
  --accent:       #58a6ff;
  --accent-warm:  #ffa657;
  --accent-soft:  #d2a8ff;
  --accent-green: #3fb950;
  --code-bg:      #161b22;
  --code-text:    #79c0ff;
}

section {
  width: 1280px;
  height: 720px;
  padding: 60px 80px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, Arial, sans-serif;
  font-size: 28px;
  line-height: 1.6;
  color: var(--text);
  background-color: var(--bg);
  display: block;
  box-sizing: border-box;
}

/* ── Headings ────────────────────────────────────────────── */
h1 {
  font-size: 2.2em;
  font-weight: 700;
  color: var(--accent);
  border-bottom: 2px solid var(--border);
  padding-bottom: 0.2em;
  margin-top: 0;
  margin-bottom: 0.5em;
  line-height: 1.25;
}
h2 {
  font-size: 1.45em;
  font-weight: 600;
  color: var(--accent-soft);
  margin-top: 0.5em;
  margin-bottom: 0.25em;
}
h3 {
  font-size: 1em;
  font-weight: 700;
  color: var(--accent-warm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.2em;
}

/* ── Lead (title slide): _class: lead ───────────────────── */
section.lead {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  background-color: #0d1117;
  background-image: linear-gradient(160deg, #0d1117 55%, #1a1f3c 100%);
  padding: 80px 100px;
}
section.lead h1 {
  font-size: 2.8em;
  border-bottom: 3px solid var(--accent);
  color: var(--text);
  margin-bottom: 0.3em;
}
section.lead h2 {
  color: var(--text-muted);
  font-size: 1.2em;
  font-weight: 400;
}
section.lead p {
  color: var(--text-muted);
  font-size: 0.9em;
}

/* ── Section divider: _class: section ───────────────────── */
section.section {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  background-color: var(--bg-subtle);
  background-image: linear-gradient(135deg, #1a1f3c 0%, #21262d 100%);
}
section.section h1 {
  font-size: 3em;
  border-bottom: none;
  color: var(--accent);
  padding-bottom: 0;
  margin-bottom: 0.2em;
}
section.section h2 {
  font-size: 1.3em;
  color: var(--text-muted);
  font-weight: 300;
}

/* ── Invert: _class: invert ─────────────────────────────── */
section.invert {
  background-color: var(--accent);
  color: #0d1117;
}
section.invert h1, section.invert h2, section.invert h3 {
  color: #0d1117;
  border-color: rgba(0, 0, 0, 0.25);
}

/* ── Code ────────────────────────────────────────────────── */
code {
  font-family: "Cascadia Code", "Fira Code", Consolas, "Liberation Mono", monospace;
  font-size: 0.82em;
  background-color: var(--code-bg);
  color: var(--code-text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.1em 0.45em;
}
pre {
  background-color: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.8em 1em;
  overflow: hidden;
  font-size: 0.8em;
}
pre code {
  border: none;
  background: none;
  padding: 0;
  font-size: 1em;
  color: var(--code-text);
}

/* ── Blockquote ──────────────────────────────────────────── */
blockquote {
  border-left: 4px solid var(--accent);
  background-color: rgba(88, 166, 255, 0.06);
  border-radius: 0 6px 6px 0;
  padding: 0.4em 1em;
  margin: 0.4em 0;
  font-style: italic;
}
blockquote p { color: var(--text); margin: 0; }

/* ── Tables ──────────────────────────────────────────────── */
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 0.82em;
  margin-top: 0.5em;
}
th {
  background-color: var(--bg-subtle);
  color: var(--accent);
  border-bottom: 2px solid var(--border);
  padding: 0.45em 0.8em;
  text-align: left;
  font-weight: 700;
}
td {
  border-bottom: 1px solid var(--border);
  padding: 0.35em 0.8em;
  color: var(--text-muted);
}
tr:nth-child(even) td { background-color: var(--bg-elevated); }
tr:hover td { color: var(--text); }

/* ── Links ───────────────────────────────────────────────── */
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ── Lists ───────────────────────────────────────────────── */
ul, ol { padding-left: 1.4em; }
li { margin: 0.25em 0; }

/* ── Header / Footer / Page number ──────────────────────── */
header, footer {
  font-size: 0.5em;
  color: var(--text-muted);
}
section::after {
  content: attr(data-marpit-pagination) ' / ' attr(data-marpit-pagination-total);
  font-size: 0.48em;
  color: var(--text-muted);
}

/* ── Image helpers ───────────────────────────────────────── */
img[alt~="center"] { display: block; margin: 0 auto; }
img[alt~="right"] { float: right; margin-left: 1em; }
img[alt~="left"] { float: left; margin-right: 1em; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// ACCORDO CORPORATE
// ─────────────────────────────────────────────────────────────────────────────
export const ACCORDO_CORPORATE = `
/**
 * @theme accordo-corporate
 * @auto-scaling true
 * @size 16:9 1280px 720px
 * @size 4:3 960px 720px
 */

:root {
  --bg:         #0f1929;
  --bg-card:    #192340;
  --bg-accent:  #1e3165;
  --border:     #2d3f72;
  --text:       #f0f4ff;
  --text-muted: #8899cc;
  --accent:     #4f8ef7;
  --gold:       #f5c242;
  --teal:       #40d9c7;
  --red:        #f56060;
}

section {
  width: 1280px;
  height: 720px;
  padding: 55px 80px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  font-size: 28px;
  line-height: 1.6;
  color: var(--text);
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse at 100% 0%, rgba(79, 142, 247, 0.1) 0%, transparent 50%),
    radial-gradient(ellipse at 0% 100%, rgba(64, 217, 199, 0.06) 0%, transparent 50%);
  display: block;
  box-sizing: border-box;
}

/* ── Headings ────────────────────────────────────────────── */
h1 {
  font-size: 2em;
  font-weight: 700;
  color: var(--text);
  border-left: 5px solid var(--accent);
  padding-left: 0.7em;
  margin-top: 0;
  margin-bottom: 0.5em;
  line-height: 1.25;
}
h2 {
  font-size: 1.3em;
  font-weight: 600;
  color: var(--teal);
  margin-bottom: 0.25em;
}
h3 {
  font-size: 0.95em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--gold);
  margin-bottom: 0.2em;
}

/* ── Lead (title slide): _class: lead ───────────────────── */
section.lead {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  padding: 80px 100px;
  background-color: var(--bg-accent);
  background-image: linear-gradient(160deg, #0f1929 0%, #1e3165 55%, #0f2060 100%);
}
section.lead h1 {
  font-size: 2.8em;
  border-left: 6px solid var(--teal);
  color: var(--text);
  margin-bottom: 0.3em;
}
section.lead h2 {
  color: var(--text-muted);
  font-size: 1.15em;
  font-weight: 300;
  border: none;
  padding-left: 0;
}
section.lead p {
  color: var(--text-muted);
  font-size: 0.85em;
  padding-left: 1.5em;
}

/* ── Section divider: _class: section ───────────────────── */
section.section {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  background-color: var(--bg-card);
  background-image: linear-gradient(160deg, #192340 0%, #0f1929 100%);
  border-top: 4px solid var(--accent);
}
section.section h1 {
  font-size: 2.8em;
  border-left: none;
  padding-left: 0;
  color: var(--accent);
  margin-bottom: 0.2em;
}
section.section h2 {
  font-size: 1.25em;
  color: var(--text-muted);
  font-weight: 300;
}

/* ── Invert accent: _class: invert ─────────────────────── */
section.invert {
  background-color: var(--accent);
  color: white;
}
section.invert h1 { color: white; border-left-color: white; }
section.invert h2, section.invert h3 { color: rgba(255,255,255,0.85); }

/* ── Code ────────────────────────────────────────────────── */
code {
  font-family: "Cascadia Code", "Fira Code", Consolas, monospace;
  font-size: 0.82em;
  background-color: var(--bg-card);
  color: var(--teal);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.1em 0.45em;
}
pre {
  background-color: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.8em 1em;
  overflow: hidden;
  font-size: 0.8em;
}
pre code { border: none; background: none; padding: 0; font-size: 1em; }

/* ── Blockquote ──────────────────────────────────────────── */
blockquote {
  border-left: 4px solid var(--gold);
  background-color: rgba(245, 194, 66, 0.06);
  border-radius: 0 6px 6px 0;
  padding: 0.4em 1em;
  margin: 0.4em 0;
  font-style: italic;
}

/* ── Tables ──────────────────────────────────────────────── */
table { border-collapse: collapse; width: 100%; font-size: 0.82em; margin-top: 0.5em; }
th {
  background-color: var(--bg-accent);
  color: var(--teal);
  border-bottom: 2px solid var(--border);
  padding: 0.45em 0.8em;
  text-align: left;
}
td { border-bottom: 1px solid var(--border); padding: 0.35em 0.8em; }
tr:nth-child(even) td { background-color: rgba(25, 35, 64, 0.5); }

/* ── Links, lists ───────────────────────────────────────── */
a { color: var(--accent); text-decoration: none; }
ul, ol { padding-left: 1.4em; }
li { margin: 0.25em 0; }

/* ── Header / Footer / Page number ──────────────────────── */
header, footer { font-size: 0.5em; color: var(--text-muted); }
section::after {
  content: attr(data-marpit-pagination) ' / ' attr(data-marpit-pagination-total);
  font-size: 0.48em;
  color: var(--text-muted);
}

/* ── Image helpers ───────────────────────────────────────── */
img[alt~="center"] { display: block; margin: 0 auto; }
img[alt~="right"] { float: right; margin-left: 1em; }
img[alt~="left"] { float: left; margin-right: 1em; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// ACCORDO LIGHT
// ─────────────────────────────────────────────────────────────────────────────
export const ACCORDO_LIGHT = `
/**
 * @theme accordo-light
 * @auto-scaling true
 * @size 16:9 1280px 720px
 * @size 4:3 960px 720px
 */

:root {
  --bg:          #ffffff;
  --bg-subtle:   #f6f8fa;
  --bg-card:     #f0f2f5;
  --border:      #d0d7de;
  --text:        #1f2328;
  --text-muted:  #636c76;
  --accent:      #0969da;
  --accent-warm: #cf4a00;
  --accent-soft: #8250df;
  --accent-green:#1a7f37;
}

section {
  width: 1280px;
  height: 720px;
  padding: 60px 80px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  font-size: 28px;
  line-height: 1.6;
  color: var(--text);
  background-color: var(--bg);
  display: block;
  box-sizing: border-box;
}

/* ── Headings ────────────────────────────────────────────── */
h1 {
  font-size: 2.2em;
  font-weight: 700;
  color: var(--text);
  border-bottom: 3px solid var(--accent);
  padding-bottom: 0.2em;
  margin-top: 0;
  margin-bottom: 0.5em;
  line-height: 1.25;
}
h2 {
  font-size: 1.45em;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 0.25em;
}
h3 {
  font-size: 1em;
  font-weight: 700;
  color: var(--accent-soft);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 0.2em;
}

/* ── Lead (title slide): _class: lead ───────────────────── */
section.lead {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  background-color: var(--bg-subtle);
  background-image: linear-gradient(135deg, #f6f8fa 0%, #e8edf5 100%);
  padding: 80px 100px;
}
section.lead h1 {
  font-size: 3em;
  color: var(--accent);
  border-bottom: 3px solid var(--accent);
  margin-bottom: 0.3em;
}
section.lead h2 {
  color: var(--text-muted);
  font-size: 1.2em;
  font-weight: 400;
  border: none;
}
section.lead p { color: var(--text-muted); font-size: 0.9em; }

/* ── Section divider: _class: section ───────────────────── */
section.section {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  background-color: var(--accent);
}
section.section h1 {
  font-size: 3em;
  border-bottom: none;
  color: white;
  padding-bottom: 0;
  margin-bottom: 0.2em;
}
section.section h2 {
  font-size: 1.3em;
  color: rgba(255,255,255,0.8);
  font-weight: 300;
}

/* ── Invert: _class: invert ─────────────────────────────── */
section.invert {
  background-color: var(--text);
  color: var(--bg);
}
section.invert h1 { color: var(--accent); border-color: var(--accent); }
section.invert h2 { color: var(--bg-subtle); }

/* ── Code ────────────────────────────────────────────────── */
code {
  font-family: "Cascadia Code", "Fira Code", Consolas, monospace;
  font-size: 0.82em;
  background-color: var(--bg-subtle);
  color: var(--accent-warm);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.1em 0.45em;
}
pre {
  background-color: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.8em 1em;
  overflow: hidden;
  font-size: 0.8em;
}
pre code { border: none; background: none; padding: 0; font-size: 1em; color: var(--text); }

/* ── Blockquote ──────────────────────────────────────────── */
blockquote {
  border-left: 4px solid var(--accent);
  background-color: rgba(9, 105, 218, 0.06);
  border-radius: 0 6px 6px 0;
  padding: 0.4em 1em;
  margin: 0.4em 0;
  font-style: italic;
}

/* ── Tables ──────────────────────────────────────────────── */
table { border-collapse: collapse; width: 100%; font-size: 0.82em; margin-top: 0.5em; }
th {
  background-color: var(--bg-subtle);
  color: var(--accent);
  border-bottom: 2px solid var(--border);
  padding: 0.45em 0.8em;
  text-align: left;
  font-weight: 700;
}
td { border-bottom: 1px solid var(--border); padding: 0.35em 0.8em; }
tr:nth-child(even) td { background-color: var(--bg-subtle); }

/* ── Links, lists ───────────────────────────────────────── */
a { color: var(--accent); text-decoration: none; }
ul, ol { padding-left: 1.4em; }
li { margin: 0.25em 0; }

/* ── Header / Footer / Page number ──────────────────────── */
header, footer { font-size: 0.5em; color: var(--text-muted); }
section::after {
  content: attr(data-marpit-pagination) ' / ' attr(data-marpit-pagination-total);
  font-size: 0.48em;
  color: var(--text-muted);
}

/* ── Image helpers ───────────────────────────────────────── */
img[alt~="center"] { display: block; margin: 0 auto; }
img[alt~="right"] { float: right; margin-left: 1em; }
img[alt~="left"] { float: left; margin-right: 1em; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// ACCORDO GRADIENT
// ─────────────────────────────────────────────────────────────────────────────
export const ACCORDO_GRADIENT = `
/**
 * @theme accordo-gradient
 * @auto-scaling true
 * @size 16:9 1280px 720px
 * @size 4:3 960px 720px
 */

:root {
  --text:       #ffffff;
  --text-muted: rgba(255, 255, 255, 0.72);
  --glass:      rgba(255, 255, 255, 0.12);
  --glass-border: rgba(255, 255, 255, 0.22);
  --code-color: #ffd700;
}

section {
  width: 1280px;
  height: 720px;
  padding: 60px 80px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  font-size: 28px;
  line-height: 1.6;
  color: var(--text);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: block;
  box-sizing: border-box;
}

/* ── Headings ────────────────────────────────────────────── */
h1 {
  font-size: 2.4em;
  font-weight: 800;
  color: white;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  margin-top: 0;
  margin-bottom: 0.4em;
  line-height: 1.2;
}
h2 {
  font-size: 1.4em;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  margin-bottom: 0.25em;
}
h3 {
  font-size: 1em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 0.2em;
}

/* ── Lead (title slide): _class: lead ───────────────────── */
section.lead {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  padding: 80px 100px;
}
section.lead h1 {
  font-size: 3.2em;
  color: white;
  text-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  margin-bottom: 0.3em;
}
section.lead h2 {
  color: rgba(255, 255, 255, 0.6);
  font-size: 1.25em;
  font-weight: 300;
  text-shadow: none;
}
section.lead p { color: rgba(255, 255, 255, 0.5); font-size: 0.9em; }

/* ── Section divider: _class: section ───────────────────── */
section.section {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 60%, #f7971e 100%);
}
section.section h1 {
  font-size: 3.5em;
  text-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  margin-bottom: 0.2em;
}
section.section h2 {
  font-size: 1.4em;
  font-weight: 300;
  opacity: 0.85;
  text-shadow: none;
}

/* ── Color class variants ───────────────────────────────── */
section.ocean { background: linear-gradient(135deg, #0c3547 0%, #1a6985 55%, #0d4d6e 100%); }
section.sunset { background: linear-gradient(135deg, #f093fb 0%, #f5576c 55%, #f7971e 100%); }
section.forest { background: linear-gradient(135deg, #134e5e 0%, #71b280 100%); }
section.midnight { background: linear-gradient(135deg, #2c3e50 0%, #3498db 100%); }
section.rose { background: linear-gradient(135deg, #c0392b 0%, #e74c3c 55%, #f39c12 100%); }
section.emerald { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); }
section.aurora { background: linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%); }

/* ── Invert: _class: invert ─────────────────────────────── */
section.invert {
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  color: #1f2328;
}
section.invert h1, section.invert h2, section.invert h3 {
  color: #1f2328;
  text-shadow: none;
}

/* ── Code ────────────────────────────────────────────────── */
code {
  font-family: "Cascadia Code", "Fira Code", Consolas, monospace;
  font-size: 0.82em;
  background-color: var(--glass);
  color: var(--code-color);
  border: 1px solid var(--glass-border);
  border-radius: 4px;
  padding: 0.1em 0.45em;
}
pre {
  background-color: rgba(0, 0, 0, 0.35);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  padding: 0.8em 1em;
  overflow: hidden;
  font-size: 0.8em;
}
pre code { border: none; background: none; padding: 0; font-size: 1em; color: var(--code-color); }

/* ── Blockquote ──────────────────────────────────────────── */
blockquote {
  border-left: 4px solid rgba(255, 255, 255, 0.6);
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 0 8px 8px 0;
  padding: 0.4em 1em;
  margin: 0.4em 0;
  font-style: italic;
}

/* ── Tables ──────────────────────────────────────────────── */
table { border-collapse: collapse; width: 100%; font-size: 0.82em; margin-top: 0.5em; }
th {
  background-color: rgba(0, 0, 0, 0.3);
  color: white;
  border-bottom: 2px solid rgba(255, 255, 255, 0.3);
  padding: 0.45em 0.8em;
  text-align: left;
}
td { border-bottom: 1px solid rgba(255, 255, 255, 0.15); padding: 0.35em 0.8em; color: rgba(255, 255, 255, 0.88); }
tr:nth-child(even) td { background-color: rgba(0, 0, 0, 0.15); }

/* ── Links, lists ───────────────────────────────────────── */
a { color: var(--code-color); text-decoration: none; }
ul, ol { padding-left: 1.4em; }
li { margin: 0.25em 0; }

/* ── Header / Footer / Page number ──────────────────────── */
header, footer { font-size: 0.5em; color: rgba(255, 255, 255, 0.55); }
section::after {
  content: attr(data-marpit-pagination) ' / ' attr(data-marpit-pagination-total);
  font-size: 0.48em;
  color: rgba(255, 255, 255, 0.5);
}

/* ── Image helpers ───────────────────────────────────────── */
img[alt~="center"] { display: block; margin: 0 auto; }
img[alt~="right"] { float: right; margin-left: 1em; }
img[alt~="left"] { float: left; margin-right: 1em; }
`;

/** All four accordo themes as an array for bulk registration. */
export const ALL_ACCORDO_THEMES = [
  ACCORDO_DARK,
  ACCORDO_CORPORATE,
  ACCORDO_LIGHT,
  ACCORDO_GRADIENT,
] as const;

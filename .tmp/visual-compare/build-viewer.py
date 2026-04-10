#!/usr/bin/env python3
"""Build viewer-v2.html for flowchart v2 comparison."""

import json

PASS_CASES = {"18", "19", "20", "21", "22", "23", "24", "41", "42"}

FAIL_REASONS = {
    "00": "strokeWidth=1 (ref=2), font size, text as separate elements",
    "01": "strokeWidth=1, rounded rect type 2 vs 3, edge label fontSize",
    "02": "strokeWidth=1, rounded rect type 2 vs 3, text layout",
    "03": "strokeWidth=1, font size mismatch, text as separate elements",
    "04": "Wrong shape: [[subroutine]] renders as extra lines; ref=single rect",
    "05": "Wrong shape: [(Database)] cylinder → OUR=ellipse, REF=rectangle",
    "06": "strokeWidth=1, rounded rect type 2 vs 3",
    "07": "strokeWidth=1, font size, text layout mismatch",
    "08": "strokeWidth=1, rounded rect, font size mismatch",
    "09": "Wrong shape: {{hexagon}} → OUR=diamond, REF=hexagon-like",
    "10": "Wrong shape: parallelogram → OUR=line (invisible), REF=rect",
    "11": "Wrong shape: parallelogram → OUR=line (invisible), REF=rect",
    "12": "Wrong shape: trapezoid → OUR=line (invisible), REF=rect",
    "13": "Wrong shape: trapezoid → OUR=line (invisible), REF=rect",
    "14": "strokeWidth=1, text layout, font size",
    "15": "strokeWidth=1, rounded rect type, font size",
    "16": "strokeWidth=1, rounded rect type, text layout",
    "17": "strokeWidth=1, font size, text as separate elements",
    "25": "strokeWidth=1, rounded rect type, font size",
    "26": "strokeWidth=1, text layout, font size",
    "27": "strokeWidth=1, rounded rect type, text elements",
    "28": "strokeWidth=1, font size, rounded rect type",
    "29": "Wrong arrowhead: OUR=dot, REF=circle/filled-dot",
    "30": "Wrong arrowhead: OUR=dot, REF=circle/filled-dot",
    "31": "strokeWidth=1, rounded rect type, font size",
    "32": "HTML entity decode broken: #quot; #9829; rendered raw",
    "33": "Reference is image — no structural comparison possible",
    "34": "Reference is image — no structural comparison possible",
    "35": "Subgraph duplicate bug + reference is image",
    "36": "Subgraph duplicate bug + reference is image",
    "37": "Reference is image — no structural comparison possible",
    "38": "strokeWidth=1, rounded rect type, font size",
    "39": "strokeWidth=1, text layout, font size",
    "40": "strokeWidth=1, rounded rect type, font size",
    "43": "Subgraph duplicate bug + reference is image",
    "44": "strokeWidth=1, rounded rect type, font size",
    "45": "Font Awesome icon prefix fa:fa-* not stripped from label text",
    "46": "strokeWidth=1, rounded rect type, font size",
    "47": "strokeWidth=1, text layout, rounded rect type",
    "48": "strokeWidth=1, rounded rect type, font size",
    "49": "Font Awesome icon prefix fa:fa-* not stripped from label text",
    "50": "Subgraph duplicate bug + reference is image",
}

# Read MMD sources
mmd_sources = {}
for i in range(51):
    case = f"{i:02d}"
    with open(f"/data/projects/accordo/demo/flowchart-v2/flowchart-{case}.mmd") as f:
        content = f.read().strip().replace("\n", " ↵ ")
    mmd_sources[case] = content

cases = []
for i in range(51):
    case = f"{i:02d}"
    reason = FAIL_REASONS.get(case, "") if case not in PASS_CASES else ""
    cases.append({"n": case, "pass": case in PASS_CASES, "reason": reason})

cases_js = json.dumps(cases)
mmd_js = json.dumps(mmd_sources)

html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Flowchart v2 — Mermaid SVG vs Our Excalidraw</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #1a1a1a; color: #eee; padding: 16px; }}
  h1 {{ font-size: 1.3rem; margin-bottom: 8px; }}
  .subtitle {{ color: #888; font-size: 0.85rem; margin-bottom: 16px; }}
  .legend {{ display: flex; gap: 16px; margin-bottom: 20px; font-size: 0.85rem; }}
  .legend span {{ padding: 3px 10px; border-radius: 4px; font-weight: bold; }}
  .pass-tag {{ background: #1a6b2a; color: #7ee89a; }}
  .fail-tag {{ background: #6b1a1a; color: #f08080; }}
  .summary {{ margin-bottom: 24px; font-size: 0.9rem; color: #aaa; }}
  .filter-bar {{ display: flex; gap: 10px; margin-bottom: 20px; }}
  .filter-bar button {{ padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: bold; }}
  #btn-all  {{ background: #444; color: #eee; }}
  #btn-pass {{ background: #1a6b2a; color: #7ee89a; }}
  #btn-fail {{ background: #6b1a1a; color: #f08080; }}
  .filter-bar button:hover {{ opacity: 0.8; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(720px, 1fr)); gap: 20px; }}
  .case {{ background: #2a2a2a; border-radius: 8px; overflow: hidden; border: 2px solid #444; }}
  .case.pass {{ border-color: #2a7a3a; }}
  .case.fail {{ border-color: #7a2a2a; }}
  .case-header {{
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-bottom: 1px solid #333;
    flex-wrap: wrap;
  }}
  .case-num {{ font-size: 1rem; font-weight: bold; color: #ddd; }}
  .verdict {{ padding: 2px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; }}
  .verdict.pass {{ background: #1a6b2a; color: #7ee89a; }}
  .verdict.fail {{ background: #6b1a1a; color: #f08080; }}
  .reason {{ font-size: 0.75rem; color: #aaa; flex: 1; }}
  .mmd-src {{ font-size: 0.7rem; color: #666; font-family: monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }}
  .imgs {{ display: flex; gap: 0; }}
  .img-panel {{ flex: 1; text-align: center; padding: 8px; border-right: 1px solid #333; }}
  .img-panel:last-child {{ border-right: none; }}
  .img-label {{ font-size: 0.72rem; color: #888; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }}
  .img-panel img {{ max-width: 100%; max-height: 320px; object-fit: contain; border: 1px solid #555; border-radius: 4px; background: #fff; }}
  .missing {{ color: #666; font-size: 0.8rem; margin-top: 8px; }}
</style>
</head>
<body>

<h1>Flowchart v2 — Mermaid SVG vs Our Excalidraw</h1>
<div class="subtitle">
  <strong>Source:</strong> demo/flowchart-v2/flowchart-XX.mmd &nbsp;&nbsp;|&nbsp;&nbsp;
  <strong>Left:</strong> Mermaid CLI → SVG &nbsp;&nbsp;|&nbsp;&nbsp;
  <strong>Right:</strong> Our library (Excalidraw JSON) → PNG
</div>
<div class="summary">
  Independent reviewer verdict: <strong style="color:#7ee89a">9 PASS</strong> · <strong style="color:#f08080">42 FAIL</strong>
</div>
<div class="legend">
  <span class="pass-tag">PASS</span> Diagrams convey the same structure
  <span class="fail-tag">FAIL</span> Structural or visual mismatch
</div>
<div class="filter-bar">
  <button id="btn-all"  onclick="filter('all')">All 51</button>
  <button id="btn-pass" onclick="filter('pass')">PASS only (9)</button>
  <button id="btn-fail" onclick="filter('fail')">FAIL only (42)</button>
</div>

<div class="grid" id="grid"></div>

<script>
const cases = {cases_js};
const mmdSources = {mmd_js};

function render(list) {{
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  list.forEach(c => {{
    const svgSrc = 'svgs/flowchart-' + c.n + '.svg';
    const pngSrc = 'flowchart-' + c.n + '-ours.png';
    const mmdText = mmdSources[c.n] || '';
    const cls = c.pass ? 'pass' : 'fail';
    const verdictText = c.pass ? 'PASS' : 'FAIL';
    let reasonHtml;
    if (c.pass) {{
      reasonHtml = '<span class="reason" style="color:#2a7a3a">Diagrams match structurally</span>';
    }} else {{
      reasonHtml = '<span class="reason" title="' + c.reason + '">' + c.reason + '</span>';
    }}
    grid.innerHTML += '<div class="case ' + cls + '" data-verdict="' + cls + '">' +
      '<div class="case-header">' +
        '<span class="case-num">Case ' + c.n + '</span>' +
        '<span class="verdict ' + cls + '">' + verdictText + '</span>' +
        reasonHtml +
        '<span class="mmd-src" title="' + mmdText + '">' + mmdText + '</span>' +
      '</div>' +
      '<div class="imgs">' +
        '<div class="img-panel">' +
          '<div class="img-label">Mermaid SVG</div>' +
          '<img src="' + svgSrc + '" alt="Mermaid SVG ' + c.n + '" loading="lazy" ' +
            'onerror="this.style.display=\\'none\\'; this.nextElementSibling.style.display=\\'block\\'">' +
          '<div class="missing" style="display:none">SVG missing</div>' +
        '</div>' +
        '<div class="img-panel">' +
          '<div class="img-label">Our Excalidraw</div>' +
          '<img src="' + pngSrc + '" alt="Our PNG ' + c.n + '" loading="lazy" ' +
            'onerror="this.style.display=\\'none\\'; this.nextElementSibling.style.display=\\'block\\'">' +
          '<div class="missing" style="display:none">PNG missing</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }});
}}

function filter(type) {{
  if (type === 'all')  render(cases);
  if (type === 'pass') render(cases.filter(c => c.pass));
  if (type === 'fail') render(cases.filter(c => !c.pass));
}}

render(cases);
</script>
</body>
</html>
"""

with open("/data/projects/accordo/.tmp/visual-compare/viewer-v2.html", "w") as f:
    f.write(html)

print("Done: viewer-v2.html")

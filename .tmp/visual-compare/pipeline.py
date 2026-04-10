#!/usr/bin/env python3
"""
Full pipeline for flowchart comparison:
1. Copy .mmd source files to demo/flowchart-v2/
2. Render each .mmd → SVG using Mermaid CLI (npx)
3. Generate our Excalidraw JSON from same .mmd files
4. Render Excalidraw JSON → PNG
5. Build HTML viewer (Mermaid SVG vs Our PNG side-by-side)

Run from .tmp/visual-compare/ directory.
"""

import subprocess
import json
import base64
import pathlib
import shutil
import sys
import time
import threading
import http.server
import socketserver

ROOT = pathlib.Path("/data/projects/accordo")
DEMO_SRC = ROOT / "demo/flowchart"  # original .mmd source
DEMO_V2 = ROOT / "demo/flowchart-v2"  # our working copy
OUT_DIR = pathlib.Path(__file__).parent  # .tmp/visual-compare/
SVG_DIR = OUT_DIR / "svgs"
OUT_JSON = OUT_DIR  # JSONs written here directly, not to "out/"
OUT_PNG = OUT_DIR  # PNGs written to same dir
V2_MMD = DEMO_V2 / "flowchart-v2"

PKG_DIAGRAM = ROOT / "packages/diagram"
MMD_SRC_DIR = str(DEMO_V2)  # passed to generate-flowchart-json.mjs


# ---------------------------------------------------------------------------
# Step 0: ensure directories
# ---------------------------------------------------------------------------
OUT_JSON.mkdir(exist_ok=True)
SVG_DIR.mkdir(exist_ok=True)
DEMO_V2.mkdir(exist_ok=True)


# ---------------------------------------------------------------------------
# Step 1: copy .mmd files to demo/flowchart-v2/  (these are our "source truth")
# ---------------------------------------------------------------------------
print("\n=== Step 1: Copying .mmd source files to demo/flowchart-v2/ ===")
for i in range(51):
    src = DEMO_SRC / f"flowchart-{i:02d}.mmd"
    dest = DEMO_V2 / f"flowchart-{i:02d}.mmd"
    shutil.copy2(src, dest)
print(f"  Copied 51 .mmd files → {DEMO_V2}")


# ---------------------------------------------------------------------------
# Step 2: render .mmd → SVG via Mermaid CLI
# ---------------------------------------------------------------------------
print("\n=== Step 2: Rendering Mermaid .mmd → SVG ===")
SVG_DIR.mkdir(exist_ok=True)

for i in range(51):
    case = f"{i:02d}"
    mmd_file = DEMO_V2 / f"flowchart-{case}.mmd"
    svg_file = SVG_DIR / f"flowchart-{case}.svg"

    cmd = [
        str(OUT_DIR / "mmdc-wrapper"),
        "-i",
        str(mmd_file),
        "-o",
        str(svg_file),
        "-b",
        "white",
        "-w",
        "1400",
    ]
    print(f"  [{case}] mmdc ... ", end="", flush=True)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if svg_file.exists() and svg_file.stat().st_size > 100:
            print(f"✓  {svg_file.stat().st_size:,} bytes")
        else:
            print(f"✗  stderr: {result.stderr[:120]}")
    except subprocess.TimeoutExpired:
        print(f"✗  timeout")
    except Exception as e:
        print(f"✗  {e}")

print(f"\n  SVG files in: {SVG_DIR}")


# ---------------------------------------------------------------------------
# Step 3: generate our Excalidraw JSON from same .mmd files
# ---------------------------------------------------------------------------
print("\n=== Step 3: Generating our Excalidraw JSON ===")

gen_script = PKG_DIAGRAM / "scripts" / "generate-flowchart-json.mjs"
# Patch the DEMO_DIR in the script to point to DEMO_V2
patched_script = OUT_DIR / "generate-flowchart-json-patched.mjs"
with open(gen_script) as f:
    src = f.read()
patched = src.replace(
    "const DEMO_DIR = '/data/projects/accordo/demo/flowchart';",
    f"const DEMO_DIR = '{DEMO_V2}';",
).replace(
    "const OUT_DIR = '/data/projects/accordo/.tmp/visual-compare/out';",
    f"const OUT_DIR = '{OUT_DIR}';",
)
with open(patched_script, "w") as f:
    f.write(patched)

result = subprocess.run(
    ["node", str(patched_script)],
    cwd=str(PKG_DIAGRAM),
    capture_output=True,
    text=True,
    timeout=120,
)
print(result.stdout[-2000:] if result.stdout else "")
if result.returncode != 0:
    print("STDERR:", result.stderr[-1000:])

patched_script.unlink()


# ---------------------------------------------------------------------------
# Step 4: render Excalidraw JSON → PNG  (adapted from render-ours.py)
# ---------------------------------------------------------------------------
print("\n=== Step 4: Rendering Excalidraw JSON → PNG ===")


def start_server(directory: pathlib.Path, port: int) -> threading.Thread:
    dir_str = str(directory)

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, directory=dir_str, **kwargs)

        def log_message(self, format: str, *args: object) -> None:
            pass

    httpd = socketserver.TCPServer(("127.0.0.1", port), QuietHandler)
    httpd.allow_reuse_address = True
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    print(f"  [server] serving {directory} on port {port}")
    return t


RENDER_HTML_TEMPLATE = """<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>body {{ margin: 0; background: white; }}</style>
</head><body>
<script src="http://localhost:{react_port}/react.production.min.js"></script>
<script src="http://localhost:{react_port}/react-dom.production.min.js"></script>
<script src="http://localhost:{exc_port}/excalidraw.production.min.js"></script>
<script>
window.__renderScene = async function(sceneJson) {{
  const scene = JSON.parse(sceneJson);
  const restored = ExcalidrawLib.restoreElements(scene.elements, null);
  const blob = await ExcalidrawLib.exportToBlob({{
    elements: restored,
    appState: {{ exportBackground: true, theme: "light", viewBackgroundColor: "#ffffff" }},
    files: scene.files || null,
  }});
  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  window.__pngB64 = btoa(binary);
  window.__done = true;
}};
window.__ready = true;
</script>
</body></html>"""


def render_json_to_png(page, scene_data: dict, port_react: int, port_exc: int) -> bytes:
    html = RENDER_HTML_TEMPLATE.format(react_port=port_react, exc_port=port_exc)
    page.set_content(html, wait_until="domcontentloaded")
    page.wait_for_function("window.__ready === true", timeout=10_000)
    scene_json_str = json.dumps(scene_data)
    page.evaluate(f"window.__renderScene({json.dumps(scene_json_str)})")
    page.wait_for_function("window.__done === true", timeout=15_000)
    b64 = page.evaluate("window.__pngB64")
    return base64.b64decode(b64)


json_files = sorted(OUT_JSON.glob("flowchart-??-ours.json"))
if not json_files:
    print("  ✗ No JSON files found — was Step 3 successful?")
else:
    PKG_NODE_MODULES = PKG_DIAGRAM / "node_modules"
    PORT_REACT, PORT_EXC = 18097, 18098
    start_server(PKG_NODE_MODULES / "react/umd", PORT_REACT)
    start_server(PKG_NODE_MODULES / "@excalidraw/excalidraw/dist", PORT_EXC)
    time.sleep(0.5)

    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for json_path in json_files:
            print(f"  rendering {json_path.name} ...", end=" ", flush=True)
            try:
                with open(json_path) as f:
                    scene_data = json.load(f)
                page = browser.new_page(viewport={"width": 1400, "height": 900})
                png_bytes = render_json_to_png(page, scene_data, PORT_REACT, PORT_EXC)
                out_png = json_path.with_suffix(".png")
                out_png.write_bytes(png_bytes)
                print(f"✓  {len(png_bytes):,} bytes")
                page.close()
            except Exception as e:
                print(f"✗  {e}")
        browser.close()

print(f"\n  PNG files in: {OUT_PNG}")


# ---------------------------------------------------------------------------
# Step 5: build HTML viewer
# ---------------------------------------------------------------------------
print("\n=== Step 5: Building HTML viewer ===")

PASS_CASES = {"18", "19", "20", "21", "22", "23", "24", "41", "42"}

FAIL_REASONS = {
    "00": "strokeWidth=1 (ref=2), font size, text as separate elements",
    "01": "strokeWidth=1, rounded rect type 2 vs 3, edge label fontSize",
    "02": "strokeWidth=1, rounded rect type 2 vs 3, text layout",
    "03": "strokeWidth=1, font size mismatch, text as separate elements",
    "04": "Wrong shape: [[subroutine]] → extra lines; ref=single rect",
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

cases_json = []
for i in range(51):
    case = f"{i:02d}"
    svg_exists = (SVG_DIR / f"flowchart-{case}.svg").exists()
    png_exists = (OUT_PNG / f"flowchart-{case}-ours.png").exists()
    reason = FAIL_REASONS.get(case, "Unknown") if case not in PASS_CASES else ""
    cases_json.append(
        {
            "n": case,
            "pass": case in PASS_CASES,
            "reason": reason,
            "svg_ok": svg_exists,
            "png_ok": png_exists,
        }
    )

cases_js = json.dumps(cases_json, indent=2)

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
  .case-header {{ display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-bottom: 1px solid #333; flex-wrap: wrap; }}
  .case-num {{ font-size: 1rem; font-weight: bold; color: #ddd; }}
  .verdict {{ padding: 2px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: bold; }}
  .verdict.pass {{ background: #1a6b2a; color: #7ee89a; }}
  .verdict.fail {{ background: #6b1a1a; color: #f08080; }}
  .reason {{ font-size: 0.78rem; color: #aaa; flex: 1; }}
  .imgs {{ display: flex; gap: 0; }}
  .img-panel {{ flex: 1; text-align: center; padding: 8px; border-right: 1px solid #333; }}
  .img-panel:last-child {{ border-right: none; }}
  .img-label {{ font-size: 0.75rem; color: #888; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }}
  .img-panel img {{ max-width: 100%; max-height: 340px; object-fit: contain; border: 1px solid #555; border-radius: 4px; background: #fff; }}
  .missing {{ color: #666; font-size: 0.8rem; margin-top: 8px; }}
</style>
</head>
<body>

<h1>Flowchart v2 — Mermaid SVG vs Our Excalidraw</h1>
<div class="subtitle">Source: demo/flowchart-v2/flowchart-XX.mmd — Left: Mermaid CLI rendered to SVG — Right: Our library rendered to PNG</div>
<div class="summary">
  Independent reviewer verdict · <strong style="color:#7ee89a">9 PASS</strong> · <strong style="color:#f08080">42 FAIL</strong>
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

function render(list) {{
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  list.forEach(c => {{
    const svgSrc = 'svgs/flowchart-' + c.n + '.svg';
    const     pngSrc = 'flowchart-' + c.n + '-ours.png';
    const cls = c.pass ? 'pass' : 'fail';
    const verdictText = c.pass ? 'PASS' : 'FAIL';
    let reasonHtml;
    if (c.pass) {{
      reasonHtml = '<span class="reason" style="color:#2a7a3a">Diagrams match structurally</span>';
    }} else {{
      reasonHtml = '<span class="reason">' + c.reason + '</span>';
    }}
    let svgImg;
    if (c.svg_ok) {{
      svgImg = '<img src="' + svgSrc + '" alt="Mermaid SVG ' + c.n + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=missing>Mermaid SVG missing</div>\'">';
    }} else {{
      svgImg = '<div class="missing">SVG not generated</div>';
    }}
    let pngImg;
    if (c.png_ok) {{
      pngImg = '<img src="' + pngSrc + '" alt="Our PNG ' + c.n + '" loading="lazy" onerror="this.parentElement.innerHTML=\'<div class=missing>PNG missing</div>\'">';
    }} else {{
      pngImg = '<div class="missing">PNG not generated</div>';
    }}
    grid.innerHTML += `
      <div class="case ${{cls}}" data-verdict="${{cls}}">
        <div class="case-header">
          <span class="case-num">Case ${{c.n}}</span>
          <span class="verdict ${{cls}}">${{verdictText}}</span>
          ${{reasonHtml}}
        </div>
        <div class="imgs">
          <div class="img-panel">
            <div class="img-label">Mermaid SVG (reference)</div>
            ${{svgImg}}
          </div>
          <div class="img-panel">
            <div class="img-label">Our Excalidraw (our code)</div>
            ${{pngImg}}
          </div>
        </div>
      </div>`;
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

viewer_path = OUT_DIR / "viewer-v2.html"
with open(viewer_path, "w") as f:
    f.write(html)

print(f"  → Viewer: {viewer_path}")
print(f"  → SVG dir: {SVG_DIR}")
print(f"  → Out dir: {OUT_DIR}")
print(f"\n=== ALL DONE ===")

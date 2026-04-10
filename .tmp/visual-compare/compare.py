#!/usr/bin/env python3
"""
Visual comparison tool for the Accordo diagram engine.

Usage:
    python3 compare.py [diagram-name]   # default: class-demo

Outputs:
    out/<name>-ours.png       — rendered from our debug JSON dump
    out/<name>-reference.png  — rendered from @excalidraw/mermaid-to-excalidraw
    out/<name>-reference.json — the reference excalidraw JSON (for inspection)

Delete this whole .tmp/visual-compare/ folder when diagram development is done.
"""

import sys
import json
import base64
import pathlib
import threading
import http.server
import socketserver
import time

from playwright.sync_api import sync_playwright

# ── Paths ────────────────────────────────────────────────────────────────────

ROOT = pathlib.Path(__file__).parent.parent.parent  # project root
PKG_DIAGRAM = ROOT / "packages/diagram/node_modules"
REACT = PKG_DIAGRAM / "react/umd/react.production.min.js"
REACT_DOM = PKG_DIAGRAM / "react-dom/umd/react-dom.production.min.js"
EXCALIDRAW = PKG_DIAGRAM / "@excalidraw/excalidraw/dist/excalidraw.production.min.js"
DEBUG_DIR = ROOT / ".accordo/diagrams/debug"
DEMO_DIR = ROOT / "demo"
OUT_DIR = pathlib.Path(__file__).parent / "out"
COMPARE_DIR = pathlib.Path(__file__).parent  # .tmp/visual-compare/

OUT_DIR.mkdir(exist_ok=True)

# ── Local HTTP server ─────────────────────────────────────────────────────────


def start_server(directory: pathlib.Path, port: int) -> threading.Thread:
    """Serve a directory on localhost:port in a background thread."""
    dir_str = str(directory)

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args: object, **kwargs: object) -> None:
            super().__init__(*args, directory=dir_str, **kwargs)  # type: ignore[misc]

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            pass

    httpd = socketserver.TCPServer(("127.0.0.1", port), QuietHandler)
    httpd.allow_reuse_address = True
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    print(f"  [server] serving {directory} on port {port}")
    return t


# ── Excalidraw renderer ───────────────────────────────────────────────────────

RENDER_HTML = """<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <style>body {{ margin: 0; background: white; }}</style>
</head><body>
  <script src="http://localhost:{react_port}/react.production.min.js"></script>
  <script src="http://localhost:{react_port}/react-dom.production.min.js"></script>
  <script src="http://localhost:{exc_port}/excalidraw.production.min.js"></script>
  <script>
    window.__renderScene = async function(sceneJson) {{
      const scene = JSON.parse(sceneJson);
      const blob = await ExcalidrawLib.exportToBlob({{
        elements: scene.elements,
        appState: {{
          exportBackground: true,
          theme: "light",
          viewBackgroundColor: "#ffffff",
        }},
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
    """Load excalidraw scene and export as PNG bytes."""
    html = RENDER_HTML.format(react_port=port_react, exc_port=port_exc)
    page.set_content(html, wait_until="domcontentloaded")
    page.wait_for_function("window.__ready === true", timeout=10_000)

    scene_json_str = json.dumps(scene_data)
    page.evaluate(f"window.__renderScene({json.dumps(scene_json_str)})")
    page.wait_for_function("window.__done === true", timeout=15_000)
    b64 = page.evaluate("window.__pngB64")
    return base64.b64decode(b64)


# ── Reference converter ───────────────────────────────────────────────────────

REFERENCE_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
  <script type="module">
    // Use esm.sh CDN — handles all mermaid dependency resolution automatically
    const { parseMermaidToExcalidraw } = await import(
      "https://esm.sh/@excalidraw/mermaid-to-excalidraw@2.2.2"
    );
    window.__parseMermaidToExcalidraw = parseMermaidToExcalidraw;
    window.__m2eReady = true;
  </script>
</body></html>"""


def get_reference_json(page, mmd_text: str) -> dict:
    """Convert mermaid text to excalidraw JSON using the reference library via CDN."""
    page.set_content(REFERENCE_HTML, wait_until="domcontentloaded")

    try:
        page.wait_for_function("window.__m2eReady === true", timeout=30_000)
    except Exception:
        # Capture console errors for debugging
        raise RuntimeError(
            "mermaid-to-excalidraw failed to load from esm.sh CDN. "
            "Check network access."
        )

    mmd_escaped = json.dumps(mmd_text)
    result = page.evaluate(f"""async () => {{
        const result = await window.__parseMermaidToExcalidraw({mmd_escaped}, {{ fontSize: 16 }});
        // Serialize files (BinaryFiles) - convert DataURL values to plain strings
        const files = {{}};
        if (result.files) {{
            for (const [id, file] of Object.entries(result.files)) {{
                files[id] = {{ ...file }};
            }}
        }}
        return {{ elements: result.elements, files }};
    }}""")
    return result


# ── Main ──────────────────────────────────────────────────────────────────────


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "class-demo"

    ours_json_path = DEBUG_DIR / f"{name}.excalidraw.json"
    mmd_path = DEMO_DIR / f"{name}.mmd"
    out_ours = OUT_DIR / f"{name}-ours.png"
    out_ref_png = OUT_DIR / f"{name}-reference.png"
    out_ref_json = OUT_DIR / f"{name}-reference.json"

    if not ours_json_path.exists():
        sys.exit(
            f"Error: {ours_json_path} not found. Run the extension on {name}.mmd first."
        )
    if not mmd_path.exists():
        sys.exit(f"Error: {mmd_path} not found.")

    print(f"\n=== Visual compare: {name} ===\n")

    # Load our debug JSON
    with open(ours_json_path) as f:
        ours_scene = json.load(f)
    print(
        f"  [ours]  loaded {len(ours_scene['elements'])} elements from {ours_json_path.name}"
    )

    # Load mermaid source
    mmd_text = mmd_path.read_text()
    print(f"  [ref]   loaded mermaid source from {mmd_path.name}")

    # Start local HTTP servers (only needed for our rendering)
    PORT_REACT = 18081
    PORT_EXC = 18082

    start_server(REACT.parent, PORT_REACT)  # react/umd/
    start_server(EXCALIDRAW.parent, PORT_EXC)  # @excalidraw/excalidraw/dist/
    time.sleep(0.5)  # let servers start

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)

        # ── Step 1: render our JSON ──
        print("\n  [step 1] rendering our JSON → PNG ...")
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        try:
            png_bytes = render_json_to_png(page, ours_scene, PORT_REACT, PORT_EXC)
            out_ours.write_bytes(png_bytes)
            print(f"  [step 1] saved {len(png_bytes):,} bytes → {out_ours}")
        finally:
            page.close()

        # ── Step 2: convert mermaid → reference JSON ──
        print("\n  [step 2] converting mermaid → reference JSON ...")
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        try:
            ref_scene = get_reference_json(page, mmd_text)
            print(f"  [step 2] reference has {len(ref_scene['elements'])} elements")
            out_ref_json.write_text(json.dumps(ref_scene, indent=2))
            print(f"  [step 2] saved reference JSON → {out_ref_json}")
        finally:
            page.close()

        # ── Step 3: render reference JSON ──
        print("\n  [step 3] rendering reference JSON → PNG ...")
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        try:
            png_bytes = render_json_to_png(page, ref_scene, PORT_REACT, PORT_EXC)
            out_ref_png.write_bytes(png_bytes)
            print(f"  [step 3] saved {len(png_bytes):,} bytes → {out_ref_png}")
        finally:
            page.close()

        browser.close()

    print(f"\n✓ Done. Images in {OUT_DIR}/")
    print(f"  {out_ours.name}")
    print(f"  {out_ref_png.name}")
    print(f"  {out_ref_json.name}\n")


if __name__ == "__main__":
    main()

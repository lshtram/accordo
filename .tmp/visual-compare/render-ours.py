#!/usr/bin/env python3
"""
Render our Excalidraw JSON files to PNGs.
Run from .tmp/visual-compare/ directory.
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

PKG_DIAGRAM = pathlib.Path("/data/projects/accordo/packages/diagram/node_modules")
REACT = PKG_DIAGRAM / "react/umd/react.production.min.js"
REACT_DOM = PKG_DIAGRAM / "react-dom/umd/react-dom.production.min.js"
EXCALIDRAW = PKG_DIAGRAM / "@excalidraw/excalidraw/dist/excalidraw.production.min.js"
OUT_DIR = pathlib.Path(__file__).parent / "out"

OUT_DIR.mkdir(exist_ok=True)


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
      // restoreElements normalises all element fields (including line.lastCommittedPoint,
      // arrow bindings, etc.) so that exportToBlob renders composite shapes correctly.
      const restored = ExcalidrawLib.restoreElements(scene.elements, null);
      const blob = await ExcalidrawLib.exportToBlob({{
        elements: restored,
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
    html = RENDER_HTML.format(react_port=port_react, exc_port=port_exc)
    page.set_content(html, wait_until="domcontentloaded")
    page.wait_for_function("window.__ready === true", timeout=10_000)
    scene_json_str = json.dumps(scene_data)
    page.evaluate(f"window.__renderScene({json.dumps(scene_json_str)})")
    page.wait_for_function("window.__done === true", timeout=15_000)
    b64 = page.evaluate("window.__pngB64")
    return base64.b64decode(b64)


def main():
    out_dir = pathlib.Path(__file__).parent / "out"

    # Find all our JSON files
    json_files = sorted(out_dir.glob("flowchart-??-ours.json"))

    if not json_files:
        print("No flowchart JSON files found in out/")
        sys.exit(1)

    print(f"\n=== Rendering {len(json_files)} JSON files to PNG ===\n")

    # Start servers
    PORT_REACT = 18097
    PORT_EXC = 18098
    start_server(REACT.parent, PORT_REACT)
    start_server(EXCALIDRAW.parent, PORT_EXC)
    time.sleep(0.5)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)

        for json_path in json_files:
            print(f"  rendering {json_path.name} ...")
            with open(json_path) as f:
                scene_data = json.load(f)

            page = browser.new_page(viewport={"width": 1400, "height": 900})
            try:
                png_bytes = render_json_to_png(page, scene_data, PORT_REACT, PORT_EXC)
                out_png = json_path.with_suffix(".png")
                out_png.write_bytes(png_bytes)
                print(f"    → saved {len(png_bytes):,} bytes → {out_png.name}")
            except Exception as e:
                print(f"    ✗ ERROR: {e}")
            finally:
                page.close()

        browser.close()

    print(f"\n✓ Done. PNGs in {out_dir}/\n")


if __name__ == "__main__":
    main()

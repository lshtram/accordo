#!/usr/bin/env python3
"""
Fetch reference JSONs for sequence diagram cases 0-19.
Uses @excalidraw/mermaid-to-excalidraw@2.2.2 via esm.sh CDN.
Run from .tmp/visual-compare/ directory.
"""

import json
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

DEMO_DIR = pathlib.Path("/data/projects/accordo/demo/sequence")
REFS_DIR = pathlib.Path("/data/projects/accordo/.tmp/visual-compare/refs")
REFS_DIR.mkdir(parents=True, exist_ok=True)

REFERENCE_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
  <script type="module">
    const { parseMermaidToExcalidraw } = await import(
      "https://esm.sh/@excalidraw/mermaid-to-excalidraw@2.2.2"
    );
    window.__parseMermaidToExcalidraw = parseMermaidToExcalidraw;
    window.__m2eReady = true;
  </script>
</body></html>"""


def get_reference_json(page, mmd_text: str) -> dict:
    page.set_content(REFERENCE_HTML, wait_until="domcontentloaded")
    try:
        page.wait_for_function("window.__m2eReady === true", timeout=30_000)
    except Exception:
        raise RuntimeError("mermaid-to-excalidraw failed to load from esm.sh CDN.")

    mmd_escaped = json.dumps(mmd_text)
    result = page.evaluate(f"""async () => {{
        const result = await window.__parseMermaidToExcalidraw({mmd_escaped}, {{ fontSize: 16 }});
        const files = {{}};
        if (result.files) {{
            for (const [id, file] of Object.entries(result.files)) {{
                files[id] = {{ ...file }};
            }}
        }}
        return {{ elements: result.elements, files }};
    }}""")
    return result


def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    end = int(sys.argv[2]) if len(sys.argv) > 2 else 19

    print(f"\n=== Fetching sequence reference JSONs {start}-{end} ===\n")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page()

        # Load CDN once
        print("  Loading CDN library...")
        page.set_content(REFERENCE_HTML, wait_until="domcontentloaded")
        try:
            page.wait_for_function("window.__m2eReady === true", timeout=30_000)
            print("  ✓ CDN library ready\n")
        except Exception as e:
            print(f"  ✗ CDN load failed: {e}")
            browser.close()
            return

        for i in range(start, end + 1):
            case_str = str(i).padStart if False else str(i).zfill(2)
            mmd_path = DEMO_DIR / f"sequence-{case_str}.mmd"
            out_path = REFS_DIR / f"sequence-{case_str}-reference.json"

            if not mmd_path.exists():
                print(f"  [{i:02d}] ✗ MMD file not found: {mmd_path}")
                continue

            mmd_text = mmd_path.read_text()

            try:
                mmd_escaped = json.dumps(mmd_text)
                result = page.evaluate(f"""async () => {{
                    const result = await window.__parseMermaidToExcalidraw({mmd_escaped}, {{ fontSize: 16 }});
                    const files = {{}};
                    if (result.files) {{
                        for (const [id, file] of Object.entries(result.files)) {{
                            files[id] = {{ ...file }};
                        }}
                    }}
                    return {{ elements: result.elements, files }};
                }}""")

                out = {
                    "type": "excalidraw",
                    "version": 2,
                    "source": f"sequence-{case_str}.mmd",
                    "elements": result["elements"],
                    "files": result.get("files", {}),
                }
                out_path.write_text(json.dumps(out, indent=2))
                count = len(result["elements"])
                types = list(set(e.get("type", "?") for e in result["elements"]))
                print(
                    f"  [{i:02d}] ✓ {count} elements [{', '.join(sorted(types))}] → {out_path.name}"
                )

            except Exception as e:
                print(f"  [{i:02d}] ✗ ERROR: {e}")

        browser.close()

    print("\n=== Done ===\n")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Clean injected CSS/JS noise from imported WordPress posts.

Two shapes seen:
 1. htmlBlock containing <style>...</style> or <script>...</script>
 2. portableText block whose spans contain raw CSS rules or JS code
"""
import sqlite3
import json
import re
import sys

DB = "/Users/malditogenio/Desktop/malditogenio-hub/projects/emdash-test/demos/simple/data.db"

STYLE_RE = re.compile(r"<style\b[^>]*>.*?</style\s*>", re.DOTALL | re.IGNORECASE)
SCRIPT_RE = re.compile(r"<script\b[^>]*>.*?</script\s*>", re.DOTALL | re.IGNORECASE)
EMPTY_P_RE = re.compile(r"<p>\s*</p>", re.IGNORECASE)

NOISE_MARKERS = (
    "!important",
    "addEventListener",
    "document.querySelector",
    "window.innerWidth",
    "querySelectorAll",
    ".offsetTop",
    ".setProperty",
    "var ol=",
    "var container",
)

def clean_html(html: str) -> tuple[str, int]:
    before = len(html)
    html = STYLE_RE.sub("", html)
    html = SCRIPT_RE.sub("", html)
    html = EMPTY_P_RE.sub("", html)
    return html, before - len(html)

def block_is_noise(block: dict) -> bool:
    if block.get("_type") != "block":
        return False
    children = block.get("children") or []
    text = " ".join(
        (c.get("text") or "") for c in children if isinstance(c, dict)
    )
    if not text.strip():
        return False
    return any(marker in text for marker in NOISE_MARKERS)

def clean_content(content_json: str) -> tuple[str, int, int]:
    try:
        blocks = json.loads(content_json)
    except Exception:
        return content_json, 0, 0
    if not isinstance(blocks, list):
        return content_json, 0, 0

    bytes_removed = 0
    blocks_dropped = 0
    new_blocks = []
    for block in blocks:
        if isinstance(block, dict):
            if block.get("_type") == "htmlBlock":
                cleaned, removed = clean_html(block.get("html", ""))
                if cleaned.strip():
                    block["html"] = cleaned
                    new_blocks.append(block)
                else:
                    blocks_dropped += 1
                bytes_removed += removed
                continue
            if block_is_noise(block):
                bytes_removed += len(json.dumps(block, ensure_ascii=False))
                blocks_dropped += 1
                continue
        new_blocks.append(block)

    return json.dumps(new_blocks, ensure_ascii=False), bytes_removed, blocks_dropped

def main(dry_run: bool = False):
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("""
        SELECT id, title, content FROM ec_posts
        WHERE content LIKE '%<style%'
           OR content LIKE '%<script%'
           OR content LIKE '%!important%'
           OR content LIKE '%addEventListener%'
    """)
    rows = cur.fetchall()
    print(f"Scanning {len(rows)} candidate posts")
    touched = 0
    total_bytes = 0
    total_blocks = 0
    for post_id, title, content in rows:
        new_content, removed, dropped = clean_content(content)
        if removed > 0 or dropped > 0:
            touched += 1
            total_bytes += removed
            total_blocks += dropped
            if not dry_run:
                cur.execute(
                    "UPDATE ec_posts SET content = ?, updated_at = datetime('now') WHERE id = ?",
                    (new_content, post_id),
                )
    if not dry_run:
        conn.commit()
    conn.close()
    action = "would clean" if dry_run else "cleaned"
    print(f"{action} {touched} posts, dropped {total_blocks} noise blocks, stripped {total_bytes:,} bytes")

if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    main(dry_run=dry)

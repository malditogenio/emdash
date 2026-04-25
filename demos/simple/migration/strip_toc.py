#!/usr/bin/env python3
"""Strip inline 'Tabla de contenido' sections from post bodies.

Patterns removed:
 1. portableText h2 block with text 'Tabla de contenido' + following normal/list
    blocks until the next h2/h3 block.
 2. htmlBlock containing rank-math-toc or similar TOC markup.
"""
import sqlite3
import json
import re
import sys

DB = "/Users/malditogenio/Desktop/malditogenio-hub/projects/emdash-test/demos/simple/data.db"

TOC_TITLES = {
    "tabla de contenido",
    "table of contents",
    "contenido de esta guia",
    "contenido",
    "indice",
    "índice",
}

HTML_TOC_MARKERS = (
    "rank-math-toc",
    'id="tabla-de-contenido"',
    'id="table-of-contents"',
    'class="wp-block-rank-math-toc',
)

def block_text(block):
    if not isinstance(block, dict):
        return ""
    if block.get("_type") == "block":
        return " ".join(
            (c.get("text") or "")
            for c in (block.get("children") or [])
            if isinstance(c, dict)
        ).strip()
    return ""

def block_style(block):
    if isinstance(block, dict) and block.get("_type") == "block":
        return (block.get("style") or "").lower()
    return ""

def is_heading_block(block):
    s = block_style(block)
    return s in ("h1", "h2", "h3", "h4")

def is_list_block(block):
    if not isinstance(block, dict):
        return False
    if block.get("_type") in ("list", "orderedList", "bulletList"):
        return True
    # portableText puts listItem as a property
    if block.get("listItem"):
        return True
    return False

def clean_content(content_json: str) -> tuple[str, int]:
    try:
        blocks = json.loads(content_json)
    except Exception:
        return content_json, 0
    if not isinstance(blocks, list):
        return content_json, 0

    new_blocks = []
    i = 0
    dropped = 0
    while i < len(blocks):
        b = blocks[i]
        # htmlBlock with TOC markers → drop
        if isinstance(b, dict) and b.get("_type") == "htmlBlock":
            html = b.get("html", "") or ""
            if any(m in html for m in HTML_TOC_MARKERS):
                dropped += 1
                i += 1
                continue

        # portableText h2 with "Tabla de contenido" → drop h2 + following
        # non-heading blocks until the next heading
        if is_heading_block(b):
            text = block_text(b).strip().lower().rstrip(":")
            if text in TOC_TITLES:
                dropped += 1
                i += 1
                # Drop subsequent blocks until next heading
                while i < len(blocks):
                    nxt = blocks[i]
                    if is_heading_block(nxt):
                        break
                    # Drop normal / list / list-item blocks
                    if isinstance(nxt, dict):
                        dropped += 1
                        i += 1
                        continue
                    i += 1
                continue

        new_blocks.append(b)
        i += 1

    return json.dumps(new_blocks, ensure_ascii=False), dropped

def main(dry_run: bool = False):
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    rows = cur.execute("SELECT id, content FROM ec_posts").fetchall()
    touched = 0
    total_dropped = 0
    for pid, content in rows:
        new_content, dropped = clean_content(content)
        if dropped > 0:
            touched += 1
            total_dropped += dropped
            if not dry_run:
                cur.execute(
                    "UPDATE ec_posts SET content = ?, updated_at = datetime('now') WHERE id = ?",
                    (new_content, pid),
                )
    if not dry_run:
        conn.commit()
    conn.close()
    action = "would strip" if dry_run else "stripped"
    print(f"{action} TOC from {touched} posts, dropped {total_dropped} blocks total")

if __name__ == "__main__":
    main("--dry-run" in sys.argv)

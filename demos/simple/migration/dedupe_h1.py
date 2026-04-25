#!/usr/bin/env python3
"""Remove leading blocks that duplicate the post title."""
import sqlite3
import json
import re
import sys

DB = "/Users/malditogenio/Desktop/malditogenio-hub/projects/emdash-test/demos/simple/data.db"

def strip_tags(html: str) -> str:
    return re.sub(r"<[^>]+>", "", html or "").strip()

def first_block_text(block) -> str:
    if not isinstance(block, dict):
        return ""
    if block.get("_type") == "block":
        return " ".join(
            (c.get("text") or "")
            for c in (block.get("children") or [])
            if isinstance(c, dict)
        ).strip()
    if block.get("_type") == "htmlBlock":
        return strip_tags(block.get("html", ""))[:300]
    return ""

def dedupe(content_json: str, title: str) -> tuple[str, bool]:
    try:
        blocks = json.loads(content_json)
    except Exception:
        return content_json, False
    if not isinstance(blocks, list) or not blocks:
        return content_json, False

    norm_title = title.strip().lower()
    # Drop up to first 2 blocks if they duplicate the title
    dropped = 0
    while blocks and dropped < 2:
        text = first_block_text(blocks[0]).lower()
        if not text:
            break
        # Match: first block text starts with first 30 chars of title
        if text.startswith(norm_title[:30]):
            blocks.pop(0)
            dropped += 1
        else:
            break
    if dropped == 0:
        return content_json, False
    return json.dumps(blocks, ensure_ascii=False), True

def main(dry_run: bool = False):
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    rows = cur.execute("SELECT id, title, content FROM ec_posts").fetchall()
    touched = 0
    for pid, title, content in rows:
        new_content, changed = dedupe(content, title)
        if changed:
            touched += 1
            if not dry_run:
                cur.execute(
                    "UPDATE ec_posts SET content = ?, updated_at = datetime('now') WHERE id = ?",
                    (new_content, pid),
                )
    if not dry_run:
        conn.commit()
    conn.close()
    action = "would dedupe" if dry_run else "deduped"
    print(f"{action} {touched} posts")

if __name__ == "__main__":
    main("--dry-run" in sys.argv)

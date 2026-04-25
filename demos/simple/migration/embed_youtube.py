#!/usr/bin/env python3
"""Convert bare YouTube URLs inside htmlBlocks to iframe embeds."""
import sqlite3
import json
import re
import sys

DB = "/Users/malditogenio/Desktop/malditogenio-hub/projects/emdash-test/demos/simple/data.db"

# Matches a <p> (or bare line) containing only a YouTube URL
YT_URL_RE = re.compile(
    r"<p>\s*(?:<a[^>]*>)?\s*(https?://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/)([A-Za-z0-9_-]{11})[^\s<]*)\s*(?:</a>)?\s*</p>",
    re.IGNORECASE,
)

IFRAME_TEMPLATE = (
    '<figure class="emdash-embed"><div class="emdash-embed-video">'
    '<iframe src="https://www.youtube-nocookie.com/embed/{vid}?rel=0&modestbranding=1&color=white" '
    'title="YouTube video" '
    'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" '
    'loading="lazy" '
    "allowfullscreen></iframe></div></figure>"
)

def convert(html: str) -> tuple[str, int]:
    count = 0
    def repl(m):
        nonlocal count
        count += 1
        return IFRAME_TEMPLATE.format(vid=m.group(2))
    new = YT_URL_RE.sub(repl, html)
    return new, count

def main(dry_run=False):
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    rows = cur.execute("SELECT id, content FROM ec_posts WHERE content LIKE '%youtube.com/watch%' OR content LIKE '%youtu.be/%'").fetchall()
    touched = 0
    total = 0
    for pid, content in rows:
        try:
            blocks = json.loads(content)
        except Exception:
            continue
        changed = False
        for b in blocks:
            if isinstance(b, dict) and b.get("_type") == "htmlBlock":
                html = b.get("html", "") or ""
                new_html, n = convert(html)
                if n > 0:
                    b["html"] = new_html
                    total += n
                    changed = True
        if changed:
            touched += 1
            if not dry_run:
                new_content = json.dumps(blocks, ensure_ascii=False)
                cur.execute(
                    "UPDATE ec_posts SET content = ?, updated_at = datetime('now') WHERE id = ?",
                    (new_content, pid),
                )
    if not dry_run:
        conn.commit()
    conn.close()
    action = "would convert" if dry_run else "converted"
    print(f"{action} {total} YouTube URLs across {touched} posts")

if __name__ == "__main__":
    main("--dry-run" in sys.argv)

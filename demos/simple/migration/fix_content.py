#!/usr/bin/env python3
"""
Content repair for imported WP posts.

Outputs NATIVE EmDash Portable Text block types so EmDash's built-in
renderers handle them correctly:

  - YouTube URLs → {_type: "embed", url, provider: "youtube"}
  - Markdown pipe tables → {_type: "table", rows, hasHeaderRow: true}

Also detects and upgrades legacy htmlBlock wrappers from earlier script runs
(so repeated invocations converge on the native shape).

Idempotent: running again on already-converted posts is a no-op.

Usage:
  python3 fix_content.py --dry-run            # preview only
  python3 fix_content.py                      # apply to all posts
  python3 fix_content.py --slug=some-post     # scope to one post
"""
import sqlite3
import json
import re
import sys
import uuid

DB = "/Users/malditogenio/Desktop/malditogenio-hub/projects/emdash-test/demos/simple/data.db"

YT_URL_RE = re.compile(
    r"https?://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube-nocookie\.com/embed/)([A-Za-z0-9_-]{11})",
    re.IGNORECASE,
)

# Match our own legacy htmlBlock wrappers from the first script iteration
LEGACY_YT_IFRAME_RE = re.compile(
    r'<iframe[^>]*src="https?://(?:www\.)?(?:youtube(?:-nocookie)?\.com/embed|youtube\.com/watch\?v=|youtu\.be)/([A-Za-z0-9_-]{11})',
    re.IGNORECASE,
)


def new_key() -> str:
    return "k" + uuid.uuid4().hex[:10]


def make_embed_block(video_id: str, key: str | None = None) -> dict:
    return {
        "_type": "embed",
        "_key": key or new_key(),
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "provider": "youtube",
    }


def make_span(text: str) -> dict:
    return {"_type": "span", "_key": new_key(), "text": text, "marks": []}


def make_table_block(rows: list[list[str]], key: str | None = None) -> dict:
    """
    Build a native EmDash table block. Shape matches packages/core/src/components/Table.astro:
      {
        _type: "table",
        rows: [
          { _type: "tableRow", cells: [
              { _type: "tableCell", content: [{_type: "span", text, marks}], isHeader }
          ]}
        ],
        hasHeaderRow: true
      }
    """
    out_rows = []
    for ri, row in enumerate(rows):
        cells = []
        for cell in row:
            cells.append(
                {
                    "_type": "tableCell",
                    "_key": new_key(),
                    "content": [make_span(cell)],
                    "markDefs": [],
                    "isHeader": ri == 0,
                }
            )
        out_rows.append(
            {"_type": "tableRow", "_key": new_key(), "cells": cells}
        )
    return {
        "_type": "table",
        "_key": key or new_key(),
        "rows": out_rows,
        "hasHeaderRow": True,
    }


def block_plain_text(block) -> str | None:
    """Return the flattened text of a portable text normal block, or None."""
    if not isinstance(block, dict):
        return None
    if block.get("_type") != "block":
        return None
    if block.get("style") not in (None, "normal"):
        return None
    children = block.get("children") or []
    parts = []
    for c in children:
        if isinstance(c, dict) and c.get("_type") == "span":
            parts.append(c.get("text", "") or "")
    return "".join(parts)


def is_only_youtube(text: str) -> str | None:
    """If the text is exactly a single YouTube URL, return the video ID."""
    stripped = (text or "").strip()
    m = YT_URL_RE.fullmatch(stripped)
    if m:
        return m.group(1)
    return None


def is_table_row(line: str) -> bool:
    s = (line or "").strip()
    return s.startswith("|") and s.endswith("|") and s.count("|") >= 2


def is_separator_row(line: str) -> bool:
    s = line.strip()
    if not (s.startswith("|") and s.endswith("|")):
        return False
    cells = [c.strip() for c in s.strip("|").split("|")]
    return len(cells) > 0 and all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c)


def split_row(line: str) -> list[str]:
    s = line.strip().strip("|")
    return [c.strip() for c in s.split("|")]


def upgrade_legacy_htmlblock(block: dict) -> dict | None:
    """
    Detect an htmlBlock produced by an earlier script run and upgrade it to
    a native embed/table block. Returns None if we don't recognize it.
    """
    if not isinstance(block, dict) or block.get("_type") != "htmlBlock":
        return None
    html = block.get("html", "") or ""
    if not html:
        return None

    m = LEGACY_YT_IFRAME_RE.search(html)
    if m:
        return make_embed_block(m.group(1), key=block.get("_key"))

    if 'class="emdash-table"' in html or "<table>" in html:
        # Best effort: parse rows/cells from our HTML template
        rows = []
        th_block = re.search(r"<thead>(.*?)</thead>", html, re.DOTALL)
        tb_block = re.search(r"<tbody>(.*?)</tbody>", html, re.DOTALL)
        if th_block:
            head_cells = re.findall(r"<th>(.*?)</th>", th_block.group(1), re.DOTALL)
            if head_cells:
                rows.append([re.sub(r"<[^>]+>", "", c).strip() for c in head_cells])
        if tb_block:
            for tr in re.findall(r"<tr>(.*?)</tr>", tb_block.group(1), re.DOTALL):
                cells = re.findall(r"<td>(.*?)</td>", tr, re.DOTALL)
                rows.append([re.sub(r"<[^>]+>", "", c).strip() for c in cells])
        if rows:
            return make_table_block(rows, key=block.get("_key"))

    return None


def process_blocks(blocks: list) -> tuple[list, dict]:
    stats = {"yt": 0, "tables": 0, "table_rows": 0, "legacy_upgrades": 0}
    out = []
    i = 0
    n = len(blocks)
    while i < n:
        block = blocks[i]

        # Upgrade legacy htmlBlocks first
        upgraded = upgrade_legacy_htmlblock(block)
        if upgraded is not None:
            out.append(upgraded)
            stats["legacy_upgrades"] += 1
            if upgraded["_type"] == "embed":
                stats["yt"] += 1
            elif upgraded["_type"] == "table":
                stats["tables"] += 1
                stats["table_rows"] += len(upgraded.get("rows") or [])
            i += 1
            continue

        text = block_plain_text(block)

        # YouTube-only plain block
        if text is not None:
            vid = is_only_youtube(text)
            if vid:
                out.append(make_embed_block(vid, key=block.get("_key")))
                stats["yt"] += 1
                i += 1
                continue

        # Table: a run of normal blocks where each is a pipe row
        if text is not None and is_table_row(text):
            run_texts = []
            j = i
            while j < n:
                t = block_plain_text(blocks[j])
                if t is None or not is_table_row(t):
                    break
                run_texts.append(t)
                j += 1

            if len(run_texts) >= 2:
                parsed = [split_row(t) for t in run_texts if not is_separator_row(t)]
                if len(parsed) >= 2:
                    out.append(make_table_block(parsed, key=block.get("_key")))
                    stats["tables"] += 1
                    stats["table_rows"] += len(parsed)
                    i = j
                    continue

        out.append(block)
        i += 1

    return out, stats


def main(dry_run: bool = False, only_slug: str | None = None):
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    q = "SELECT id, slug, content FROM ec_posts WHERE deleted_at IS NULL"
    params: tuple = ()
    if only_slug:
        q += " AND slug = ?"
        params = (only_slug,)
    rows = cur.execute(q, params).fetchall()

    totals = {"yt": 0, "tables": 0, "table_rows": 0, "legacy_upgrades": 0}
    touched = 0
    for pid, slug, content in rows:
        try:
            blocks = json.loads(content)
        except Exception:
            continue
        new_blocks, stats = process_blocks(blocks)
        if stats["yt"] + stats["tables"] > 0:
            touched += 1
            for k in totals:
                totals[k] += stats[k]
            print(
                f"  {slug}: yt={stats['yt']} tables={stats['tables']} "
                f"rows={stats['table_rows']} legacy_upgrades={stats['legacy_upgrades']}"
            )
            if not dry_run:
                new_content = json.dumps(new_blocks, ensure_ascii=False)
                cur.execute(
                    "UPDATE ec_posts SET content = ?, updated_at = datetime('now') WHERE id = ?",
                    (new_content, pid),
                )

    if not dry_run:
        conn.commit()
    conn.close()
    action = "would fix" if dry_run else "fixed"
    print(
        f"\n{action}: {totals['yt']} YouTube, {totals['tables']} tables "
        f"({totals['table_rows']} rows), {totals['legacy_upgrades']} legacy upgrades "
        f"across {touched} posts"
    )


if __name__ == "__main__":
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    only_slug = None
    for a in args:
        if a.startswith("--slug="):
            only_slug = a.split("=", 1)[1]
    main(dry_run=dry_run, only_slug=only_slug)

#!/usr/bin/env python3
"""
Convert legacy WordPress CTA blockquotes to native EmDash inlineAd blocks.

The WXR import left inline CTAs (newsletter, curso, etc.) as Portable Text
blockquotes with a link markDef pointing to andresospina.co landing pages.
Those look ugly as inline blue-italic text — they should be real ad cards.

This script finds blockquote blocks whose children contain a link to a known
CTA URL and replaces them with {_type: "inlineAd", variant: "..."}, which
the [slug].astro template renders via the InlineAd.astro component
(PortableText custom renderer).

Idempotent. Re-running does nothing on already-converted posts.

Usage:
  python3 convert_cta_blockquotes.py --dry-run            # preview only
  python3 convert_cta_blockquotes.py                      # apply to all posts
  python3 convert_cta_blockquotes.py --slug=some-post     # scope to one post
"""
import sqlite3
import json
import sys
import uuid

DB = "/Users/malditogenio/Desktop/malditogenio-hub/projects/emdash-test/demos/simple/data.db"

# Map CTA URL substrings → InlineAd variant slug
URL_TO_VARIANT = [
    ("/newsletter", "newsletter"),
    ("/curso-claude-code", "curso"),
    ("/curso", "curso"),
    ("/inteligencia-artificial-empresas", "ia"),
    ("/conferencias", "conferencias"),
    ("/contacto", "catchall"),
]


def new_key() -> str:
    return "k" + uuid.uuid4().hex[:10]


def detect_variant(block) -> str | None:
    """
    Inspect a portable text block. If it's a blockquote with an inline link
    whose href matches a known CTA URL, return the variant slug. Otherwise None.
    """
    if not isinstance(block, dict):
        return None
    if block.get("_type") != "block":
        return None
    if block.get("style") != "blockquote":
        return None

    mark_defs = block.get("markDefs") or []
    for md in mark_defs:
        if md.get("_type") != "link":
            continue
        href = (md.get("href") or "").lower()
        if not href:
            continue
        for needle, variant in URL_TO_VARIANT:
            if needle in href:
                return variant
    return None


def process_blocks(blocks: list) -> tuple[list, int]:
    converted = 0
    out = []
    for block in blocks:
        variant = detect_variant(block)
        if variant:
            out.append(
                {
                    "_type": "inlineAd",
                    "_key": block.get("_key") or new_key(),
                    "variant": variant,
                }
            )
            converted += 1
        else:
            out.append(block)
    return out, converted


def main(dry_run: bool = False, only_slug: str | None = None):
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    q = "SELECT id, slug, content FROM ec_posts WHERE deleted_at IS NULL"
    params: tuple = ()
    if only_slug:
        q += " AND slug = ?"
        params = (only_slug,)
    rows = cur.execute(q, params).fetchall()

    total_converted = 0
    touched_posts = 0
    by_variant: dict[str, int] = {}

    for pid, slug, content in rows:
        try:
            blocks = json.loads(content)
        except Exception:
            continue
        new_blocks, count = process_blocks(blocks)
        if count > 0:
            touched_posts += 1
            total_converted += count
            # Tally variants
            for b in new_blocks:
                if isinstance(b, dict) and b.get("_type") == "inlineAd":
                    v = b.get("variant", "?")
                    by_variant[v] = by_variant.get(v, 0) + 1
            print(f"  {slug}: converted {count} blockquote CTA(s)")
            if not dry_run:
                new_content = json.dumps(new_blocks, ensure_ascii=False)
                cur.execute(
                    "UPDATE ec_posts SET content = ?, updated_at = datetime('now') WHERE id = ?",
                    (new_content, pid),
                )

    if not dry_run:
        conn.commit()
    conn.close()

    action = "would convert" if dry_run else "converted"
    print(f"\n{action} {total_converted} CTA blockquotes across {touched_posts} posts")
    if by_variant:
        print("by variant:", ", ".join(f"{k}={v}" for k, v in sorted(by_variant.items())))


if __name__ == "__main__":
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    only_slug = None
    for a in args:
        if a.startswith("--slug="):
            only_slug = a.split("=", 1)[1]
    main(dry_run=dry_run, only_slug=only_slug)

# Migration scripts — WordPress → EmDash

One-shot Python scripts used to repair content imported from the
WordPress WXR export (`andrsospina.WordPress.2026-04-13.xml`).

These are **not runtime code**. They manipulate `demos/simple/data.db`
directly to clean up imported Portable Text content. Keep them out of
application code paths.

## Philosophy

- Each script is **idempotent**: running it twice is a no-op on already-clean posts.
- Each script accepts `--dry-run` to preview changes.
- Each script accepts `--slug=<slug>` to scope to a single post.
- Prefer **native EmDash block types** over raw HTML stuffed into `htmlBlock`
  (raw HTML gets sanitized — `src` on iframes from non-whitelisted hostnames
  is dropped, for example). See `fix_content.py` for the correct pattern.

## Order of operations (full repair from fresh WXR import)

Run in this order. Each one can be re-run safely at any point.

```bash
cd projects/emdash-test/demos/simple

# 1. Strip broken inline <style>/<script> tags imported from the old theme
python3 migration/clean_posts.py

# 2. Remove duplicate H1s (WXR sometimes repeats the post title as first H1)
python3 migration/dedupe_h1.py

# 3. Strip inline "Tabla de contenido" / "Contenido de esta guía" blocks
python3 migration/strip_toc.py

# 4. (Optional / legacy) Convert YouTube URLs wrapped inside htmlBlocks
#    Superseded by fix_content.py — kept for reference only.
#    python3 migration/embed_youtube.py

# 5. Repair content to native EmDash block types:
#    - YouTube URLs → {_type:"embed", provider:"youtube"}
#    - Markdown pipe tables → {_type:"table"}
#    Detects and upgrades legacy htmlBlocks from prior runs.
python3 migration/fix_content.py --dry-run   # preview
python3 migration/fix_content.py              # apply to all posts

# 6. Convert legacy inline CTA blockquotes to proper InlineAd card blocks:
#    - style:"blockquote" + link to /newsletter → {_type:"inlineAd", variant:"newsletter"}
#    - style:"blockquote" + link to /curso-claude-code → {_type:"inlineAd", variant:"curso"}
#    - etc. (see URL_TO_VARIANT map in the script)
#    The [slug].astro template renders these via InlineAd.astro as a
#    PortableText custom component, giving every legacy CTA the same
#    production-grade talk-card styling as template-level ads.
python3 migration/convert_cta_blockquotes.py --dry-run
python3 migration/convert_cta_blockquotes.py
```

## Script-by-script reference

### `clean_posts.py`
Strips broken inline `<style>` / `<script>` that came through from the old
Semplice theme CSS dump. Touches posts where those blocks are orphaned from
any real markup.

### `dedupe_h1.py`
Removes the first H1 of a post when it matches the post title verbatim
(WordPress stores the title separately, so rendering both is a duplicate).

### `strip_toc.py`
Removes inline "Tabla de contenido" / "Contenido de esta guía" sections
that were rendered inline by the old plugin. The new site has a real TOC
sidebar built from H2s in `src/pages/[slug].astro`.

### `embed_youtube.py` (legacy, superseded)
Original YouTube converter. Scoped only to URLs already inside htmlBlocks.
Left in place for reference but **`fix_content.py` supersedes it** —
`fix_content.py` catches plain-text blocks AND upgrades legacy htmlBlock
wrappers produced by `embed_youtube.py` into native `embed` blocks.

### `fix_content.py` (current best-practice repair)
Outputs **native EmDash block types** so EmDash's built-in Portable Text
renderers handle them without going through the sanitizer.

Detects:
- Plain-text blocks whose content is only a YouTube URL → `{_type:"embed"}`
- Consecutive pipe-row blocks that form a markdown table → `{_type:"table"}`
- Legacy `htmlBlock` wrappers produced by earlier script runs → upgrades
  to the native shape.

This is the script to use going forward. The others are still useful as
pre-clean steps for a fresh WXR re-import.

### `convert_cta_blockquotes.py`
Converts legacy inline CTA blockquotes (newsletter, curso, inmersión IA,
etc.) to typed `{_type: "inlineAd", variant: "..."}` blocks. The site
renders these via `src/components/InlineAd.astro` (passed to EmDash's
PortableText component as a custom type renderer in `[slug].astro`).

**Why not a plugin?** For now, this is a content-level transform that
keeps the render in a plain Astro component. A proper EmDash plugin with
admin-UI insertion of the block type would be the next step if authors
need to insert inline ads from the editor.

**URL → variant map** lives at the top of the script — edit it to cover
new landing pages.

## Re-running the import from scratch

`demos/simple/data.db.backup` preserves the state right after the initial
WXR import. If you ever need to replay the cleanup pipeline, restore it:

```bash
cp demos/simple/data.db.backup demos/simple/data.db
```

Then run the scripts in the order above.

## Not in this folder (on purpose)

- Anything that belongs to runtime rendering (Astro components, CSS).
  Those live in `src/`.
- Plugins and hooks that should run on every content save. Those go in
  EmDash's plugin system (`packages/` in a larger monorepo, or a site-local
  plugin entry once the project needs one).

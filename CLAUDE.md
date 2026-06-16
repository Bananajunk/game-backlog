# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`Backlog` is a mobile-first, **local-first** video-game backlog tracker. The repo holds the project foundation, a marketing landing page at `/`, and the start of the tracker app at `/app` (`src/pages/app/index.astro`), which now has a manual **add-game form** and a **backlog list** (the FIFO queue, with manual up/down reordering, inline edit of a game's title/platforms, delete behind a confirmation dialog, and a **Start Playing** action that moves a game into the `playing` status) — the remaining tracker views are not built yet. Planned capabilities: multiple "currently playing" games across platforms, completed/dropped history, a chain/timeline view, and manual next-game selection.

## Commands

```bash
bun install       # install dependencies (writes bun.lock)
bun run dev       # dev server at http://localhost:4321
bun run build     # static build to ./dist/
bun run preview   # serve the built site
bun run check     # astro check — type-checks .astro/.ts (run this as the "lint")
```

There is **no test framework** wired up; `astro check` is the only automated gate. Run it (and ideally `bun run build`) before considering a change done.

## Hard constraints (do not violate without being asked)

- **No React, no UI framework, no client-side router/state library.** The landing page ships **zero client JS**. Use Astro components; reach for a vanilla Web Component only where genuine interactivity is later required.
- **No backend, auth, database, or external API** (no IGDB / IsThereAnyDeal) yet. The app is local-first by design.
- The two landing CTAs (`Start Tracking`, `View Demo`) are placeholders that scroll to `#preview`. The `/app` route now has a working **add a game** form and a **backlog list**, but the CTAs still point to `#preview` — wire `Start Tracking` to `/app` only once the tracker is usable.

## Architecture & conventions

**Tailwind v4, no config file.** Tailwind is wired through the first-party `@tailwindcss/vite` plugin in `astro.config.mjs` — there is intentionally **no `tailwind.config.js`**. All theme tokens are declared in a single `@theme { … }` block at the top of `src/styles/global.css`. Each token is therefore *both* a CSS custom property (`var(--color-bg)`) *and* a generated utility (`bg-bg`, `text-ink`, `border-line`, `rounded-card`, …). **Edit theme tokens there**, not inline; changing one updates the whole site. Note Tailwind v4's default border color is `currentColor`, so every border must name its color (e.g. `border-line`).

**Two kinds of border, by contrast tier.** `--color-line` / `--color-line-strong` are *decorative* (below 3:1) and must never be the sole signal of anything. `--color-control-border` exists specifically for interactive-control boundaries and meets WCAG 1.4.11 (≥3:1). Use the latter for anything a user clicks.

**Accessibility is a maintained invariant, not a nicety.** Preserve these when editing:
- Strict heading order `h1 → h2 → h3` (one `h1`).
- Status is conveyed **four ways at once** — marker shape + glyph + text label + color — never color alone. Keep all four when adding states.
- Focus rings use `:focus-visible` (not `:focus`); the reduced-motion media query in `global.css` disables all animation. Don't introduce motion that carries meaning.

**The timeline mock (`TimelinePreview.astro` + `.timeline`/`.t-*` rules in `global.css`)** is pure HTML/CSS — no SVG for the rail, no JS. The rail is one continuous `::before` line; status markers and the "branch" (a CSS elbow off the rail implying a second active game) are absolutely positioned against it. Gotcha: row marker rules are scoped with the **direct-child combinator** (`.t-row[data-status="playing"] > .t-node`) so the nested branch node keeps its own styling — a plain descendant selector wins on specificity and breaks the branch. Keep that `> ` when touching these rules.

**Vite is pinned via `overrides` in `package.json`.** The `@tailwindcss/vite` peer pulls Vite 8 while Astro 5 runs on Vite 6; the mismatch breaks `astro check`'s types. The `"overrides": { "vite": "^6.4.3" }` forces a single major. Bun honors this `overrides` field, so the pin applies under `bun install` too. Don't remove it without re-checking `astro check`.

**Bun is the toolchain — package manager and runner.** The lockfile is `bun.lock` (text format); there is **no `package-lock.json`**. Bun is pinned in `.bun-version` (currently `1.3.3`); CI pins the same via `bun-version-file`, and Cloudflare Pages is pinned via a `BUN_VERSION` build environment variable set to the same value. **Keep all three in lockstep** — a Bun version mismatch is what makes a committed lockfile fail a `--frozen-lockfile` install. This pinning is deliberate: it sidesteps the npm-version lockfile drift (npm 10 vs 11 disagree on the `@tailwindcss/oxide`/`lightningcss` wasm-fallback deps) that Cloudflare's unpinnable npm would otherwise impose. `.nvmrc` still pins Node 24 as a compatible baseline for any tool that shells out to `node`, but the build itself runs under Bun. When bumping Bun, update `.bun-version`, re-run `bun install`, commit the new `bun.lock`, and bump Cloudflare's `BUN_VERSION`.

`BaseLayout.astro` owns the `<html>`/`<head>` shell and accepts `title`/`description` props. `AppLayout.astro` wraps `BaseLayout`, takes a single `title` prop, and adds the sticky app nav bar (the "Backlog" brand mark plus placeholder `Playing`/`Backlog`/`History` links) above a `<slot />`; it deliberately renders no heading, so the page keeps its own `<h1>`. `FeatureCard.astro` takes `title`/`description` props plus a named `icon` slot.

**`AddGameForm.ts` (`<add-game-form>`) is the project's first Web Component** and the template for any future interactive control. It's a **light-DOM** custom element (no shadow root) so the global theme tokens, the `.btn`/`.card` classes, and the global `:focus-visible` ring all apply; its own styling lives in `global.css` under `@layer components` (like the timeline), **not** as Tailwind utilities in the `.ts` file. On submit it appends a `Game` + a `backlog` `UserGame` through the `src/lib/storage.ts` helpers, then dispatches a `game-added` event on `document` for other views to react to. Two gotchas: the page loads it via a **bundled** `<script>import "../../components/AddGameForm"</script>` (an Astro static build won't serve a `src="/src/…"` URL), and the form uses `novalidate` + JS validation so the empty-title case shows our own inline error instead of the browser's native bubble (the `required` attribute is kept for semantics).

**`BacklogList.ts` (`<backlog-list>`)** is the second light-DOM component, following the same conventions (styling in `global.css` under `@layer components`; bundled import alongside `AddGameForm`). It reads `loadState()` and renders the `backlog` user-games as a `<ul>` in FIFO order (`sortOrder` asc, `dateAdded` tiebreaker), re-rendering on the `game-added` / `game-removed` / `game-updated` / `status-changed` events. It uses **event delegation** (one click listener on the element, which survives the `innerHTML` re-render) and **escapes all interpolated strings** since it injects user-entered titles. Each row renders the title, platform badges, a relative "Added N … ago" date, and `[Start Playing] | [Edit] | [Remove]` plus `↑`/`↓` reorder buttons. **Up/down reordering** swaps `sortOrder` with the neighbour, persists, and fires `game-updated`, restoring focus to the moved button. **`[Edit]` transforms the row in place into an inline form** (#8): a pre-filled title input + platform checkboxes (from the shared `PLATFORMS` list, see below) + Save/Cancel, with one row editable at a time (`editingId`), Enter-to-save (the form's `submit`) / Escape-to-cancel, focus moving to the title input on entry and back to `[Edit]` on exit, and an in-flight `EditDraft` captured across re-renders so an unrelated reorder doesn't wipe what was typed. Save updates the `Game`'s `title`/`platforms`, persists, and fires `game-updated`. **`[Remove]` opens a confirmation `<dialog>`** (#9): a single reusable native `<dialog role="alertdialog" aria-modal="true">` (lazily built and kept in `document.body`, *not* inside the re-rendered `<ul>`, so an `innerHTML` rebuild can't wipe or move it). `showModal()` provides the focus trap + Escape-to-dismiss for free; `Confirm Remove` (the `.btn-danger` red ghost button) deletes the `UserGame` — and its linked `Game` only if no other `UserGame` still references it — then `saveState()`s and fires `game-removed`, while `Cancel`/Escape just close. A single `close` listener returns focus to the triggering `[Remove]` button when it still exists (the cancel/Escape paths; on a confirmed delete its row is already gone). **`[Start Playing]` flips the game to `playing`** (#10): it sets `status = "playing"` and stamps `dateStarted` (`new Date().toISOString()`) at the moment of the click — never on load — persists, and fires a `status-changed` `CustomEvent` carrying `{ id, newStatus: "playing" }`. No confirmation; the list re-renders off that event and the row drops out (it no longer matches `status === 'backlog'`), and the playing view (M4) is the other intended listener. **The multi-game friction warning is deferred to M4 — starting is unrestricted for now.**

**Platform options are a single source of truth: `src/lib/platforms.ts` exports the `PLATFORMS` list**, imported by both `<add-game-form>` (entry) and `<backlog-list>`'s edit form so the two checkbox sets can't drift. The edit form also offers any of a game's existing platforms that aren't in `PLATFORMS`, so a non-standard value is never silently dropped on save.

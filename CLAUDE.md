# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`Backlog` is a mobile-first, **local-first** video-game backlog tracker. The repo holds the project foundation, a marketing landing page at `/`, and a placeholder app shell at `/app` (`src/pages/app/index.astro`) — the tracker features themselves are not built yet. Planned capabilities: a FIFO backlog queue, multiple "currently playing" games across platforms, completed/dropped history, a chain/timeline view, and manual next-game selection.

## Commands

```bash
npm run dev       # dev server at http://localhost:4321
npm run build     # static build to ./dist/
npm run preview   # serve the built site
npm run check     # astro check — type-checks .astro/.ts (run this as the "lint")
```

There is **no test framework** wired up; `astro check` is the only automated gate. Run it (and ideally `npm run build`) before considering a change done.

## Hard constraints (do not violate without being asked)

- **No React, no UI framework, no client-side router/state library.** The landing page ships **zero client JS**. Use Astro components; reach for a vanilla Web Component only where genuine interactivity is later required.
- **No backend, auth, database, or external API** (no IGDB / IsThereAnyDeal) yet. The app is local-first by design.
- The two landing CTAs (`Start Tracking`, `View Demo`) are placeholders that scroll to `#preview`. The `/app` route now exists as a bare placeholder shell, but the CTAs still point to `#preview` — wire `Start Tracking` to `/app` only once the tracker is usable.

## Architecture & conventions

**Tailwind v4, no config file.** Tailwind is wired through the first-party `@tailwindcss/vite` plugin in `astro.config.mjs` — there is intentionally **no `tailwind.config.js`**. All theme tokens are declared in a single `@theme { … }` block at the top of `src/styles/global.css`. Each token is therefore *both* a CSS custom property (`var(--color-bg)`) *and* a generated utility (`bg-bg`, `text-ink`, `border-line`, `rounded-card`, …). **Edit theme tokens there**, not inline; changing one updates the whole site. Note Tailwind v4's default border color is `currentColor`, so every border must name its color (e.g. `border-line`).

**Two kinds of border, by contrast tier.** `--color-line` / `--color-line-strong` are *decorative* (below 3:1) and must never be the sole signal of anything. `--color-control-border` exists specifically for interactive-control boundaries and meets WCAG 1.4.11 (≥3:1). Use the latter for anything a user clicks.

**Accessibility is a maintained invariant, not a nicety.** Preserve these when editing:
- Strict heading order `h1 → h2 → h3` (one `h1`).
- Status is conveyed **four ways at once** — marker shape + glyph + text label + color — never color alone. Keep all four when adding states.
- Focus rings use `:focus-visible` (not `:focus`); the reduced-motion media query in `global.css` disables all animation. Don't introduce motion that carries meaning.

**The timeline mock (`TimelinePreview.astro` + `.timeline`/`.t-*` rules in `global.css`)** is pure HTML/CSS — no SVG for the rail, no JS. The rail is one continuous `::before` line; status markers and the "branch" (a CSS elbow off the rail implying a second active game) are absolutely positioned against it. Gotcha: row marker rules are scoped with the **direct-child combinator** (`.t-row[data-status="playing"] > .t-node`) so the nested branch node keeps its own styling — a plain descendant selector wins on specificity and breaks the branch. Keep that `> ` when touching these rules.

**Vite is pinned via `overrides` in `package.json`.** The `@tailwindcss/vite` peer pulls Vite 8 while Astro 5 runs on Vite 6; the mismatch breaks `astro check`'s types. The `"overrides": { "vite": "^6.4.3" }` forces a single major. Don't remove it without re-checking `astro check`.

`BaseLayout.astro` owns the `<html>`/`<head>` shell and accepts `title`/`description` props; `FeatureCard.astro` takes `title`/`description` props plus a named `icon` slot.

# Backlog

> Finish more games. Start fewer by accident.

A mobile-first, **local-first** game backlog tracker. This repository contains
the project foundation, a polished marketing landing page, and a placeholder
app shell at `/app` — the tracker features themselves come next.

The eventual app will let players:

- Track games in a **backlog** (FIFO queue)
- Mark games as **currently playing** (multiple, across platforms)
- Mark games as **completed** or **dropped**
- View their history in a **chain / timeline** layout
- Pick their next game manually

## Tech stack

- **[Astro](https://astro.build) 5** — static-first, ships zero JS by default
- **TypeScript** (strict)
- **[Tailwind CSS](https://tailwindcss.com) v4** — via the first-party
  `@tailwindcss/vite` plugin; theme tokens live in CSS, not a config file
- **No React.** No client-side framework, no router, no state library
- **No backend, no auth, no database** yet

## Getting started

This project uses [Bun](https://bun.com) (pinned in `.bun-version`).

```bash
# 1. install dependencies
bun install

# 2. start the dev server  →  http://localhost:4321
bun run dev
```

### All scripts

| Command           | Action                                            |
| ----------------- | ------------------------------------------------- |
| `bun run dev`     | Start the local dev server at `localhost:4321`    |
| `bun run build`   | Build the production site to `./dist/`            |
| `bun run preview` | Preview the production build locally              |
| `bun run check`   | Type-check `.astro`/`.ts` files (`astro check`)   |

## Project structure

```
backlog/
├── astro.config.mjs        # Astro config; wires in Tailwind v4 via @tailwindcss/vite
├── tsconfig.json           # extends astro/tsconfigs/strict
├── package.json
├── public/
│   └── favicon.svg         # inline timeline-motif favicon
└── src/
    ├── env.d.ts
    ├── types/
    │   └── index.ts       # core domain types (Game, UserGame, AppState) — source of truth
    ├── lib/
    │   ├── storage.ts     # localStorage load/save + generateId; seeds demo data on first run
    │   └── seedData.ts    # one-time demo data across all four statuses (no Date.now, no API)
    ├── styles/
    │   └── global.css      # @import "tailwindcss" + @theme tokens + components
    ├── layouts/
    │   ├── BaseLayout.astro # <html> shell, <head> meta, dark color-scheme
    │   └── AppLayout.astro  # wraps BaseLayout; adds the sticky app nav bar
    ├── components/
    │   ├── FeatureCard.astro    # reusable feature card (named `icon` slot)
    │   └── TimelinePreview.astro # static chain/timeline mock (pure CSS)
    └── pages/
        ├── index.astro     # the landing page (hero, features, preview, footer)
        └── app/
            └── index.astro # the app shell (placeholder; uses AppLayout)
```

## Theming

All theme tokens are declared once in `src/styles/global.css` inside Tailwind
v4's `@theme` block, so each token is **both** a real CSS custom property
(`var(--color-bg)`) **and** a generated utility (`bg-bg`, `text-ink`,
`border-line`, `rounded-card`, …). Editing a token there updates the whole site.

The palette is a near-black, cool-neutral "instrument panel" with a single mint
accent rationed to the live game node and the primary CTA.

## Accessibility

- Semantic landmarks (`header` / `main` / `footer` / `nav`) and a strict
  heading hierarchy (`h1` → `h2` → `h3`, no skips)
- A "Skip to main content" link as the first focusable element
- Visible, non-animated focus rings on every interactive element
- **WCAG 2.1 AA contrast**, verified by computation — body/label text clears
  4.5:1 and UI/graphical objects clear 3:1
- **Status is never conveyed by color alone** — every play-state is encoded by
  marker **shape** + **glyph** + **text label** in addition to hue
- `prefers-reduced-motion: reduce` disables all motion; nothing essential is
  carried by animation

## What's intentionally not here yet

No database, auth, API integrations, or state management, and no client-side
router (routes are plain Astro pages). No IGDB or IsThereAnyDeal integration.
The `/app` route currently has its app layout and nav bar but no tracker
features yet; the two landing-page CTAs still scroll to the in-page preview and
will point at the app once the tracker is usable.

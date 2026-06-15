---
name: solve-github-issue
description: >-
  End-to-end workflow for resolving a GitHub issue in this repo: fetch the
  issue, implement the change to spec, verify it (astro check + build + browser
  preview), keep CLAUDE.md and README.md accurate, and auto-open a draft PR
  that closes the issue. Use this whenever the user pastes a GitHub issue link (or an issue
  number) and asks to solve / fix / implement / "do" / "knock out" / "pick up"
  that issue — even if they don't say the word "skill". Also use it when they
  say "let's do the next issue" or reference a milestone issue by number.
---

# Solve a GitHub issue

This skill turns a GitHub issue link into a verified, draft PR for **this repo**
(an Astro 5, local-first, zero-framework project). It captures a workflow that
already proved out once, so follow the sequence — but stay a thinking engineer,
not a script-runner. The steps exist to protect three things: the issue's own
acceptance criteria, the hard constraints in `CLAUDE.md`, and a clean,
reviewable PR. Keep those outcomes in mind and adapt where a step doesn't fit.

## Inputs

The user gives you an issue **URL** (`https://github.com/OWNER/REPO/issues/N`) or
just a number. Parse `OWNER`, `REPO`, and `N` from the URL. For a bare number,
derive the repo from the git remote (`gh repo view --json nameWithOwner`).

## The workflow

### 1. Read the issue, then read the code

Fetch the full issue — body, labels, milestone, comments — so nothing in it is
guessed at:

```bash
gh issue view N --repo OWNER/REPO --json number,title,body,labels,milestone,state,comments
```

Issues here are written with explicit **Requirements**, **Constraints**, and
**Acceptance criteria** sections, and they name the **relevant existing files**.
Read every file the issue points at, plus `CLAUDE.md`, plus the obvious
neighbours (e.g. the existing page/component you're mirroring). You're learning
the conventions before you touch anything — import style, container classes,
the theme tokens in `src/styles/global.css`, the accessibility patterns. The
goal is that your change reads like it was already there.

### 2. Implement to spec — and only to spec

Make the **smallest** change that satisfies the requirements and acceptance
criteria. These issues are milestoned and sequenced: a later issue almost always
builds the layout/nav/state/data that a placeholder issue deliberately omits.
Resist the urge to "finish" the feature — over-building creates merge churn and
front-runs work that's scoped to another issue. If you find yourself adding
something the issue didn't ask for, stop and reconsider.

Honour the hard constraints in `CLAUDE.md` without being reminded — they
override default behaviour:

- **No React / UI framework / client router / state lib.** Plain `.astro`; a
  vanilla Web Component only where genuine interactivity is truly required.
- **Zero client-side JS** on pages that don't need it (the landing page ships
  none).
- **Theme tokens, not inline colours.** Use the generated utilities
  (`bg-bg`, `text-ink`, `text-ink-dim`, `border-line`, `rounded-card`, the
  `.kicker` class, …) declared in the `@theme` block of `global.css`. Borders
  must name a colour (Tailwind v4's default is `currentColor`).
- **Accessibility is an invariant:** strict heading order (one `h1`, then
  `h2`→`h3`); status conveyed four ways (shape + glyph + label + colour), never
  colour alone; `:focus-visible` rings; reduced-motion respected.
- **No backend / auth / DB / external API** yet — local-first by design.

### 3. Verify — never hand the user a "should work"

Two gates are mandatory; the third applies whenever the change is observable in
a browser. Re-run after every fix until green.

```bash
npm run check    # astro check — must report 0 errors (this is the "lint")
npm run build    # must succeed AND emit the expected route/artifact
```

If the change renders something (a new page or route, a visible UI change),
verify it for real with the preview tools — don't ask the user to look:

1. `preview_start` with name `backlog-dev` (defined in `.claude/launch.json`,
   serves `http://localhost:4321`).
2. Navigate to the route (`preview_eval` → `window.location.href = '/your/route'`),
   confirming the fetch returns **200**.
3. `preview_snapshot` — confirm the structure/text (e.g. the right `h1`, a
   single `main`).
4. `preview_console_logs` with `level: "error"` — must be empty.
5. `preview_screenshot` — capture proof to show the user.

In your reply, state each gate's result plainly (e.g. "`astro check` → 0
errors", "build emits `/app/index.html`", "200, no console errors"). The preview
tool's own overlay (Menu/Inspect/Audit/Settings buttons) is not part of the
page — don't report it as app content.

### 4. Keep CLAUDE.md and README.md honest

`CLAUDE.md` and `README.md` are the project's living documentation — `CLAUDE.md`
is read into context every session, and `README.md` is the first thing a
contributor sees. Both go stale the instant a feature lands while the prose
still describes the "before" state. After your change, scan **both** for any
statement your work just made false and make **targeted, minimal** edits to fix
exactly those — don't rewrite sections that are still accurate.

- **`CLAUDE.md`** — the "What this is" summary, the hard-constraint notes, file
  inventories, any "not built yet" / "no app route yet" phrasing.
- **`README.md`** — the intro paragraph ("currently contains … the tracker app
  itself comes next"), the **Project structure** file tree (add or rename the
  files you created/moved), the **All scripts** table (new commands), and the
  **What's intentionally not here yet** section — e.g. it lists "no routing,"
  which is false the moment an app route exists.

Treat this as part of the issue, not an afterthought: a doc that says a feature
doesn't exist when your PR adds it is a doc that lies to every future reader and
every future session. The issue isn't done until the docs agree with the code.

### 5. Branch, commit, and open a draft PR (automatic)

Once everything is green, go straight through without pausing — a draft PR is
low-risk and reversible, and the user reviews it on GitHub before marking it
ready.

```bash
git switch -c <type>/<short-kebab-slug>      # feat/… or fix/…, off main
```

**Stage only the files your issue touched.** Inspect `git status` first and add
files by name — never `git add -A`. There may be unrelated working-tree changes
(e.g. a pre-existing `package-lock.json` modification) that must NOT ride along
in this PR.

```bash
git add CLAUDE.md src/pages/app/index.astro    # example — your actual files
```

Commit with a descriptive subject + body that explains the *what* and *why*,
linking the issue so it auto-closes on merge. End with the required trailer:

```
<subject line>

<body: what changed and why, wrapped ~72 cols>

Closes #N

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

Push and open the **draft** PR:

```bash
git push -u origin <branch>
gh pr create --repo OWNER/REPO --base main --head <branch> --draft \
  --title "<title>" --body "<body with 'Closes #N' and the sections below>"
```

PR body: a short **What**, a **Details** bullet list, the **Verification**
results (the gate outcomes from step 3), a **Docs** note if you touched
`CLAUDE.md` or `README.md`, and an **Out of scope** note for anything you deliberately left out
(like that unrelated `package-lock.json` change). End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then report the PR URL and remind the user they can mark it ready with
`gh pr ready <number> --repo OWNER/REPO`.

### 6. After merge — sync and clean up

When the user says it's merged, leave the tree tidy:

```bash
git switch main && git pull --ff-only origin main
git branch -d <branch>
# delete the remote branch only if GitHub didn't auto-delete it on merge:
git ls-remote --exit-code --heads origin <branch> >/dev/null 2>&1 \
  && git push origin --delete <branch> || echo "remote branch already gone"
gh issue view N --repo OWNER/REPO --json state -q .state   # expect CLOSED
```

Confirm `main` fast-forwarded to the merge commit and the issue is `CLOSED`. If
an unrelated change (e.g. `package-lock.json`) was intentionally left out, note
that it's still uncommitted so the user isn't surprised.

## Quick reference

| Phase | Command / tool |
| --- | --- |
| Fetch issue | `gh issue view N --repo OWNER/REPO --json number,title,body,labels,milestone,state,comments` |
| Type gate | `npm run check` (0 errors) |
| Build gate | `npm run build` (emits the route) |
| Browser proof | `preview_start` (`backlog-dev`) → `preview_eval` nav → `preview_snapshot` → `preview_console_logs` → `preview_screenshot` |
| Branch | `git switch -c feat/<slug>` |
| Draft PR | `gh pr create --draft --base main --body "…Closes #N…"` |
| Post-merge | `git pull --ff-only` · delete branch · confirm issue `CLOSED` |

## Pitfalls that have actually bitten

- **Staging everything.** `git add -A` drags unrelated working-tree changes into
  the PR. Add files by name.
- **Over-building a placeholder.** If the issue says "placeholder shell", ship a
  shell. The next issue wants the nav/state/data.
- **Skipping browser verification** on a visible change because the build
  passed. A green build doesn't prove the page renders or is error-free at
  runtime.
- **Letting the docs drift.** A finished feature that still reads as "not built
  yet" in `CLAUDE.md` — or is missing from the `README.md` structure tree, or
  contradicts its "not here yet" section — is an unfinished issue. Check both.
- **Wrong heading level / colour-only status.** These break documented
  accessibility invariants even when `astro check` stays green.

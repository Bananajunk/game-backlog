import { loadState, saveState } from '../lib/storage';
import type { Game, UserGame } from '../types';

/** State-change events (dispatched on `document`) that should re-render the dashboard. */
const CHANGE_EVENTS = [
  'game-added',
  'game-removed',
  'game-updated',
  'status-changed',
] as const;

/** One day in milliseconds, for the "Playing for N days" elapsed count. */
const DAY_MS = 86_400_000;

/** How many backlog games the post-completion picker offers as next-up. */
const NEXT_PICKS = 3;

/** The completion outcome that opened the ceremony — drives its wording and the
 *  status the game lands in on [Save & Continue]. */
type CeremonyOutcome = 'completed' | 'dropped';

/** Where focus should land after the next render (keyboard users keep their
 *  place across the ceremony's step transitions and re-renders). */
type PendingFocus =
  | { kind: 'rating'; id: string } // the rating input, on opening step 1
  | { kind: 'next'; id: string } // the first picker control, on reaching step 2
  | { kind: 'reopenButton'; id: string; outcome: CeremonyOutcome }; // the trigger, on cancelling step 1

/**
 * `<playing-dashboard>` — the "Currently Playing" section (M4) and the focal
 * point of `/app`: the first/primary section on the page, above the backlog.
 * It supersedes the M3 `<playing-list>` (the deliberately simpler forerunner),
 * keeping that component's status transitions but presenting each in-progress
 * game as a larger, more prominent card.
 *
 * Renders every `playing` {@link UserGame}, sorted by `dateStarted` ascending
 * (earliest started first, `dateAdded` as the tiebreaker), led by a
 * "Currently playing: N game(s)" count. Each card shows the title (large), the
 * platform badge(s), a "Playing for N days" elapsed count derived from
 * `dateStarted` to now, and three exits out of "playing":
 *
 *   [Mark Complete]   → opens the post-completion ceremony, then "completed"
 *   [Drop Game]       → opens the post-completion ceremony, then "dropped"
 *   [Back to Backlog] → status "backlog", clears `dateStarted`, re-queues at
 *                       the end (`sortOrder` = the current backlog length)
 *
 * **Post-completion ceremony (#15).** [Mark Complete] and [Drop Game] no longer
 * transition directly — they open a two-step ceremony that replaces the card in
 * place. Both steps render as sibling `<section>`s in the DOM at once; only the
 * active one shows, toggled by `data-step` on the panel (CSS `display`, never JS
 * fiddling). Step 1 confirms the outcome ("You completed X!" / "You dropped X.")
 * and takes an *optional* 1–10 rating; [Save & Continue] stamps `dateCompleted`,
 * saves the rating if given, flips the status, and persists — but does **not**
 * announce yet. Step 2 ("What's next?") offers the top {@link NEXT_PICKS} backlog
 * games (by `sortOrder`), each [Start Playing], plus [Skip for now]. Starting a
 * pick flips it to "playing", and skipping just dismisses; either way the flow
 * then dispatches one `status-changed` so every view re-reads fresh state (the
 * completion lands in the history view, the started pick leaves the backlog).
 * The outcome is carried by the headline wording, never colour alone. Only one
 * ceremony runs at a time (`ceremonyId`), Escape backs out (step 1 cancels with
 * no state change; step 2 skips), and focus is shepherded across the steps.
 *
 * [Back to Backlog] stays a raw transition: it stamps nothing, clears
 * `dateStarted`, re-queues the game, persists, then announces `status-changed`.
 *
 * The dashboard re-renders off {@link CHANGE_EVENTS} so a game started from the
 * backlog appears here immediately and an acted card drops out. When nothing is
 * playing it shows an empty-state prompt.
 *
 * The "Playing for N days" count is computed inside {@link render} from a single
 * `Date.now()` read taken at render time — never at module scope — so it's fresh
 * on every re-render and survives bundling/static-build evaluation order.
 *
 * Rendered into light DOM (no shadow root) so the global theme tokens, the
 * `.btn`/`.card` classes, and the global `:focus-visible` ring all apply; its
 * styling lives in `global.css` under `@layer components`, like the backlog and
 * history lists and the timeline — not as Tailwind utilities here. It escapes
 * all interpolated strings since it injects user-entered titles.
 */
class PlayingDashboard extends HTMLElement {
  /** The single game in the ceremony, by `UserGame.id`, or null. */
  private ceremonyId: string | null = null;

  /** Which action opened the ceremony — sets the wording and the final status. */
  private ceremonyOutcome: CeremonyOutcome | null = null;

  /** 1 = confirm + rate, 2 = next-game picker. */
  private ceremonyStep: 1 | 2 = 1;

  /** Restored after a render so keyboard users keep their place across steps. */
  private pendingFocus: PendingFocus | null = null;

  private readonly onStateChange = () => this.render();

  private readonly onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-action]',
    );
    if (!button) return;
    const action = button.dataset.action;

    // The picker's [Start Playing] targets a backlog game by its own id, not the
    // ceremony game whose panel encloses it — so read it before falling through.
    if (action === 'start-next') {
      const nextId = button.dataset.nextId;
      if (nextId) this.startNext(nextId);
      return;
    }

    const id = button.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!id) return;

    switch (action) {
      case 'complete':
        this.openCeremony(id, 'completed');
        break;
      case 'drop':
        this.openCeremony(id, 'dropped');
        break;
      case 'backlog':
        this.backToBacklog(id);
        break;
      case 'skip':
        this.skip();
        break;
    }
  };

  /** [Save & Continue] is the rating form's submit, so Enter works too. */
  private readonly onSubmit = (event: Event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>(
      'form.ceremony-rating-form',
    );
    if (!form) return;
    event.preventDefault();
    this.saveAndContinue();
  };

  /** Escape backs out of the ceremony: step 1 cancels (no state change), step 2
   *  skips (the completion was already saved, so it just dismisses). */
  private readonly onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || this.ceremonyId === null) return;
    event.preventDefault();
    if (this.ceremonyStep === 1) this.cancelCeremony();
    else this.skip();
  };

  connectedCallback() {
    this.addEventListener('click', this.onClick);
    this.addEventListener('submit', this.onSubmit);
    this.addEventListener('keydown', this.onKeydown);
    for (const name of CHANGE_EVENTS) {
      document.addEventListener(name, this.onStateChange);
    }
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('submit', this.onSubmit);
    this.removeEventListener('keydown', this.onKeydown);
    for (const name of CHANGE_EVENTS) {
      document.removeEventListener(name, this.onStateChange);
    }
  }

  /** Playing user-games, earliest started first (`dateAdded` breaks ties). */
  private playingGames(state: ReturnType<typeof loadState>): UserGame[] {
    return state.userGames
      .filter((userGame) => userGame.status === 'playing')
      .sort(
        (a, b) =>
          (a.dateStarted ?? '').localeCompare(b.dateStarted ?? '') ||
          a.dateAdded.localeCompare(b.dateAdded),
      );
  }

  /** Top backlog games offered by the next-game picker: `sortOrder` ascending,
   *  `dateAdded` as the tiebreaker (mirroring `<backlog-list>`), capped at
   *  {@link NEXT_PICKS}. */
  private nextPicks(state: ReturnType<typeof loadState>): UserGame[] {
    return state.userGames
      .filter((userGame) => userGame.status === 'backlog')
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.dateAdded.localeCompare(b.dateAdded),
      )
      .slice(0, NEXT_PICKS);
  }

  /** Open the post-completion ceremony on a card at step 1. Nothing is persisted
   *  yet — that waits for [Save & Continue]. Only one runs at a time: setting
   *  `ceremonyId` replaces any other. */
  private openCeremony(id: string, outcome: CeremonyOutcome) {
    this.ceremonyId = id;
    this.ceremonyOutcome = outcome;
    this.ceremonyStep = 1;
    this.pendingFocus = { kind: 'rating', id };
    this.render(); // nothing persisted — render directly, not via an event
  }

  /** Dismiss step 1 without completing; the game stays "playing" and focus
   *  returns to the [Mark Complete]/[Drop Game] button that opened it. */
  private cancelCeremony() {
    const id = this.ceremonyId;
    const outcome = this.ceremonyOutcome;
    if (!id || !outcome) return;
    this.resetCeremony();
    this.pendingFocus = { kind: 'reopenButton', id, outcome };
    this.render();
  }

  /** Step 1 → step 2. Commit the completion: flip the status, stamp
   *  `dateCompleted` at the click (never on load), save the rating if one was
   *  entered, persist. Deliberately does *not* announce yet — other views learn
   *  of the completion when the flow ends (skip / start-next), so the history
   *  view doesn't update mid-ceremony. */
  private saveAndContinue() {
    const id = this.ceremonyId;
    const outcome = this.ceremonyOutcome;
    if (!id || !outcome) return;

    const state = loadState();
    const userGame = state.userGames.find((ug) => ug.id === id);
    if (!userGame) {
      // Card vanished underneath us — abandon the flow cleanly.
      this.resetCeremony();
      this.render();
      return;
    }

    userGame.status = outcome;
    userGame.dateCompleted = new Date().toISOString();
    const rating = this.readRating();
    if (rating !== undefined) userGame.rating = rating;
    saveState(state);

    this.ceremonyStep = 2;
    this.pendingFocus = { kind: 'next', id };
    this.render(); // self only — the announcement waits for the flow to close
  }

  /** Read the optional rating from the live step-1 input: an integer 1–10, or
   *  undefined when blank or out of range (the field is optional, so anything
   *  invalid is simply not stored). */
  private readRating(): number | undefined {
    const input = this.querySelector<HTMLInputElement>('input[name="rating"]');
    const raw = input?.value.trim();
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 1 && value <= 10
      ? value
      : undefined;
  }

  /** Step 2 [Start Playing]: move the chosen backlog game into "playing", stamp
   *  `dateStarted`, persist, close the flow, then announce `status-changed`. The
   *  single event re-renders every view off fresh state, so the completion saved
   *  in step 1 surfaces in the history view and the started pick leaves the
   *  backlog — all at once. */
  private startNext(nextId: string) {
    const state = loadState();
    const userGame = state.userGames.find((ug) => ug.id === nextId);
    if (!userGame) return; // backlog row vanished underneath us — nothing to do

    userGame.status = 'playing';
    userGame.dateStarted = new Date().toISOString();
    saveState(state);

    this.resetCeremony();
    this.pendingFocus = null; // the panel is leaving on this render
    document.dispatchEvent(
      new CustomEvent('status-changed', {
        detail: { id: nextId, newStatus: 'playing' },
      }),
    );
  }

  /** Step 2 [Skip for now] (and step-2 Escape): close the flow without starting
   *  anything, then announce the completion that was committed in step 1 so the
   *  history and other views catch up. */
  private skip() {
    const id = this.ceremonyId;
    const outcome = this.ceremonyOutcome;
    this.resetCeremony();
    this.pendingFocus = null; // the panel is leaving on this render
    if (id && outcome) {
      document.dispatchEvent(
        new CustomEvent('status-changed', {
          detail: { id, newStatus: outcome },
        }),
      );
    } else {
      this.render(); // nothing to announce — just refresh
    }
  }

  private resetCeremony() {
    this.ceremonyId = null;
    this.ceremonyOutcome = null;
    this.ceremonyStep = 1;
  }

  /** [Back to Backlog] — a raw transition (no ceremony). Re-queue at the back:
   *  count the current backlog (this game is still "playing", so it's excluded)
   *  and use that as the new `sortOrder`, mirroring how `<add-game-form>` appends.
   *  Clear `dateStarted`, persist, then announce; the card leaves on re-render. */
  private backToBacklog(id: string) {
    const state = loadState();
    const userGame = state.userGames.find((ug) => ug.id === id);
    if (!userGame) return; // card vanished underneath us — nothing to do

    const backlogLength = state.userGames.filter(
      (ug) => ug.status === 'backlog',
    ).length;
    userGame.status = 'backlog';
    userGame.dateStarted = undefined;
    userGame.sortOrder = backlogLength;
    saveState(state);

    document.dispatchEvent(
      new CustomEvent('status-changed', {
        detail: { id: userGame.id, newStatus: 'backlog' },
      }),
    );
  }

  private render() {
    // Capture the in-flight rating so an external re-render during step 1 (e.g.
    // a game added elsewhere) doesn't wipe what the user typed — mirrors
    // <backlog-list>'s edit-draft capture.
    const ratingDraft = this.captureRatingDraft();

    const state = loadState();
    const games = this.playingGames(state);
    const gamesById = new Map(state.games.map((game) => [game.id, game]));

    // The ceremony game (if any). In step 1 it's still "playing"; in step 2 it's
    // already completed/dropped, so look it up across all user-games.
    const ceremonyGame =
      this.ceremonyId != null
        ? (state.userGames.find((ug) => ug.id === this.ceremonyId) ?? null)
        : null;
    // It disappeared from under us (removed elsewhere) — drop the dangling flow.
    if (this.ceremonyId != null && ceremonyGame == null) this.resetCeremony();

    // Read "now" once, here at render time (never at module scope), so every
    // card's "Playing for N days" is computed fresh on each re-render.
    const now = Date.now();
    const items = games.map((userGame) =>
      ceremonyGame && userGame.id === ceremonyGame.id
        ? this.ceremonyPanel(
            ceremonyGame,
            gamesById.get(ceremonyGame.gameId),
            state,
            ratingDraft,
          )
        : this.card(userGame, gamesById.get(userGame.gameId), now),
    );
    // Step 2: the ceremony game is completed/dropped, so it's no longer in
    // `games` above — surface its panel at the top of the list.
    if (ceremonyGame && ceremonyGame.status !== 'playing') {
      items.unshift(
        this.ceremonyPanel(
          ceremonyGame,
          gamesById.get(ceremonyGame.gameId),
          state,
          ratingDraft,
        ),
      );
    }

    if (items.length === 0) {
      this.innerHTML =
        '<p class="playing-dashboard-empty">Nothing playing right now. Pick something from your backlog!</p>';
      return;
    }

    // The count reflects games actually in "playing"; suppress it when the only
    // thing on screen is the ceremony panel (step 2 with nothing else playing).
    const count =
      games.length > 0
        ? `<p class="playing-dashboard-count">Currently playing: ${games.length} ${games.length === 1 ? 'game' : 'games'}</p>`
        : '';
    this.innerHTML = `${count}<ul class="playing-dashboard-list">${items.join('')}</ul>`;

    this.restoreFocus();
  }

  private card(userGame: UserGame, game: Game | undefined, now: number): string {
    const safeTitle = escapeHtml(game?.title ?? 'Untitled game');

    const platforms = (game?.platforms ?? [])
      .map((name) => `<span class="platform-badge">${escapeHtml(name)}</span>`)
      .join('');
    const platformsBlock = platforms
      ? `<div class="playing-card-platforms">${platforms}</div>`
      : '';

    const elapsed = playingForLabel(userGame.dateStarted, now);

    return `
      <li class="playing-card card" data-id="${escapeHtml(userGame.id)}">
        <div class="playing-card-main">
          <p class="playing-card-title">${safeTitle}</p>
          ${platformsBlock}
          <p class="playing-card-elapsed">${escapeHtml(elapsed)}</p>
        </div>
        <div class="playing-card-actions">
          <button type="button" class="btn btn-secondary" data-action="complete">Mark Complete</button>
          <button type="button" class="btn btn-secondary" data-action="drop">Drop Game</button>
          <button type="button" class="btn btn-secondary" data-action="backlog">Back to Backlog</button>
        </div>
      </li>`;
  }

  /** The post-completion ceremony panel that replaces a card. Both steps render
   *  as sibling `<section>`s; only the one matching `data-step` shows (toggled by
   *  CSS `display`). `ratingDraft`, when present, pre-fills the rating input so an
   *  external re-render can't discard an in-progress entry. */
  private ceremonyPanel(
    userGame: UserGame,
    game: Game | undefined,
    state: ReturnType<typeof loadState>,
    ratingDraft: string | null,
  ): string {
    const safeId = escapeHtml(userGame.id);
    const safeTitle = escapeHtml(game?.title ?? 'Untitled game');
    const ratingId = `ceremony-rating-${safeId}`;

    const headline =
      this.ceremonyOutcome === 'dropped'
        ? `You dropped ${safeTitle}.`
        : `You completed ${safeTitle}!`;

    // Prefer the in-flight draft, then a rating already saved (step 2 re-render).
    const ratingValue =
      ratingDraft != null
        ? escapeHtml(ratingDraft)
        : typeof userGame.rating === 'number'
          ? String(userGame.rating)
          : '';

    const gamesById = new Map(state.games.map((g) => [g.id, g]));
    const picks = this.nextPicks(state)
      .map((pick) => {
        const title = escapeHtml(gamesById.get(pick.gameId)?.title ?? 'Untitled game');
        return `
            <li class="ceremony-next-item">
              <span class="ceremony-next-title">${title}</span>
              <button type="button" class="btn btn-secondary" data-action="start-next" data-next-id="${escapeHtml(pick.id)}">Start Playing</button>
            </li>`;
      })
      .join('');
    const pickerBody = picks
      ? `<ul class="ceremony-next-list">${picks}</ul>`
      : '<p class="ceremony-next-empty">Your backlog is empty — nothing to start next.</p>';

    return `
      <li class="ceremony-card card" data-id="${safeId}" data-step="${this.ceremonyStep}">
        <section class="ceremony-step ceremony-step-1" aria-label="Confirm and rate">
          <p class="ceremony-headline">${headline}</p>
          <form class="ceremony-rating-form" novalidate>
            <div class="ceremony-rating-field">
              <label for="${ratingId}">How would you rate it? <span class="field-optional">(optional, 1–10)</span></label>
              <input id="${ratingId}" name="rating" type="number" min="1" max="10" step="1" inputmode="numeric" autocomplete="off" value="${ratingValue}" />
            </div>
            <button type="submit" class="btn btn-primary">Save &amp; Continue</button>
          </form>
        </section>
        <section class="ceremony-step ceremony-step-2" aria-label="Pick your next game">
          <h3 class="ceremony-next-heading">What's next?</h3>
          ${pickerBody}
          <button type="button" class="btn btn-secondary" data-action="skip">Skip for now</button>
        </section>
      </li>`;
  }

  /** Read the live rating value, or null when step 1 isn't currently shown. */
  private captureRatingDraft(): string | null {
    if (this.ceremonyId == null || this.ceremonyStep !== 1) return null;
    const input = this.querySelector<HTMLInputElement>('input[name="rating"]');
    return input ? input.value : null;
  }

  /** Place focus where the last interaction left off after a re-render. */
  private restoreFocus() {
    const focus = this.pendingFocus;
    this.pendingFocus = null;
    if (!focus) return;

    const panel = this.querySelector<HTMLElement>(`[data-id="${focus.id}"]`);
    if (!panel) return;

    if (focus.kind === 'rating') {
      panel.querySelector<HTMLInputElement>('input[name="rating"]')?.focus();
      return;
    }
    if (focus.kind === 'next') {
      // First picker control: a [Start Playing], else [Skip for now].
      const target =
        panel.querySelector<HTMLElement>('[data-action="start-next"]') ??
        panel.querySelector<HTMLElement>('[data-action="skip"]');
      target?.focus();
      return;
    }
    // reopenButton: the card is back to normal — focus the trigger we came from.
    const selector =
      focus.outcome === 'dropped'
        ? '[data-action="drop"]'
        : '[data-action="complete"]';
    panel.querySelector<HTMLElement>(selector)?.focus();
  }
}

/** Escape a string for safe interpolation into HTML text and attributes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "Playing for N days" from `dateStarted` to `now` (ms). The number of whole
 *  days is computed by the caller's render-time `now`, never a module-scope
 *  clock. Falls back to "less than a day" for a same-day start and for a
 *  missing/unparseable `dateStarted` (a playing game should always have one). */
function playingForLabel(dateStarted: string | undefined, now: number): string {
  const started = dateStarted ? new Date(dateStarted).getTime() : NaN;
  const days = Number.isNaN(started)
    ? 0
    : Math.max(0, Math.floor((now - started) / DAY_MS));
  if (days < 1) return 'Playing for less than a day';
  if (days === 1) return 'Playing for 1 day';
  return `Playing for ${days} days`;
}

if (!customElements.get('playing-dashboard')) {
  customElements.define('playing-dashboard', PlayingDashboard);
}

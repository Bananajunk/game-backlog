import { loadState, saveState } from '../lib/storage';
import type { Game, UserGame } from '../types';

/** State-change events (dispatched on `document`) that should re-render the dashboard. */
const CHANGE_EVENTS = [
  'game-added',
  'game-removed',
  'game-updated',
  'status-changed',
] as const;

/** The three status transitions a playing game can exit through. */
type PlayingExit = 'completed' | 'dropped' | 'backlog';

/** One day in milliseconds, for the "Playing for N days" elapsed count. */
const DAY_MS = 86_400_000;

/**
 * `<playing-dashboard>` — the "Currently Playing" section (M4) and the focal
 * point of `/app`: the first/primary section on the page, above the backlog.
 * It supersedes the M3 `<playing-list>` (the deliberately simpler forerunner),
 * keeping that component's three raw status transitions but presenting each
 * in-progress game as a larger, more prominent card.
 *
 * Renders every `playing` {@link UserGame}, sorted by `dateStarted` ascending
 * (earliest started first, `dateAdded` as the tiebreaker), led by a
 * "Currently playing: N game(s)" count. Each card shows the title (large), the
 * platform badge(s), a "Playing for N days" elapsed count derived from
 * `dateStarted` to now, and the three exits out of "playing":
 *
 *   [Mark Complete]   → status "completed", stamps `dateCompleted`
 *   [Drop Game]       → status "dropped",   stamps `dateCompleted`
 *   [Back to Backlog] → status "backlog",   clears `dateStarted`, re-queues at
 *                       the end (`sortOrder` = the current backlog length)
 *
 * Each transition stamps its date at the moment of the click (never on load),
 * persists via {@link saveState}, then dispatches a `status-changed`
 * CustomEvent carrying `{ id, newStatus }` — the same pattern `<backlog-list>`'s
 * Start Playing uses (#10). The dashboard re-renders off that event (among the
 * other {@link CHANGE_EVENTS}) so the acted card drops out the instant it's no
 * longer "playing", and a game started from the backlog appears here
 * immediately. When nothing is playing it shows an empty-state prompt. Rating
 * and the post-completion ceremony remain M4 follow-ups — these are the raw
 * transitions only.
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
  private readonly onStateChange = () => this.render();

  private readonly onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-action]',
    );
    if (!button) return;
    const id = button.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!id) return;

    switch (button.dataset.action) {
      case 'complete':
        this.transition(id, 'completed');
        break;
      case 'drop':
        this.transition(id, 'dropped');
        break;
      case 'backlog':
        this.transition(id, 'backlog');
        break;
    }
  };

  connectedCallback() {
    this.addEventListener('click', this.onClick);
    for (const name of CHANGE_EVENTS) {
      document.addEventListener(name, this.onStateChange);
    }
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
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

  /** Apply one of the three "playing" exits to a game, stamp the relevant date
   *  at the moment of the click (never on load), persist, then announce
   *  `status-changed`. The acted card leaves on the re-render — it no longer
   *  matches `status === 'playing'`. */
  private transition(id: string, newStatus: PlayingExit) {
    const state = loadState();
    const userGame = state.userGames.find((ug) => ug.id === id);
    if (!userGame) return; // card vanished underneath us — nothing to do

    if (newStatus === 'backlog') {
      // Re-queue at the back: count the current backlog (this game is still
      // "playing", so it's excluded) and use that count as the new sortOrder,
      // mirroring how <add-game-form> appends a freshly added game.
      const backlogLength = state.userGames.filter(
        (ug) => ug.status === 'backlog',
      ).length;
      userGame.status = 'backlog';
      userGame.dateStarted = undefined;
      userGame.sortOrder = backlogLength;
    } else {
      // completed | dropped — both stamp dateCompleted at the transition.
      userGame.status = newStatus;
      userGame.dateCompleted = new Date().toISOString();
    }
    saveState(state);

    document.dispatchEvent(
      new CustomEvent('status-changed', {
        detail: { id: userGame.id, newStatus },
      }),
    );
  }

  private render() {
    const state = loadState();
    const games = this.playingGames(state);

    if (games.length === 0) {
      this.innerHTML =
        '<p class="playing-dashboard-empty">Nothing playing right now. Pick something from your backlog!</p>';
      return;
    }

    // Read "now" once, here at render time (never at module scope), so every
    // card's "Playing for N days" is computed fresh on each re-render.
    const now = Date.now();
    const gamesById = new Map(state.games.map((game) => [game.id, game]));
    const cards = games
      .map((userGame) => this.card(userGame, gamesById.get(userGame.gameId), now))
      .join('');

    const count = `Currently playing: ${games.length} ${games.length === 1 ? 'game' : 'games'}`;
    this.innerHTML = `
      <p class="playing-dashboard-count">${count}</p>
      <ul class="playing-dashboard-list">${cards}</ul>`;
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

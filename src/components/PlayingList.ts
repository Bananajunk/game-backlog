import { loadState, saveState } from '../lib/storage';
import type { Game, UserGame } from '../types';

/** State-change events (dispatched on `document`) that should re-render the list. */
const CHANGE_EVENTS = [
  'game-added',
  'game-removed',
  'game-updated',
  'status-changed',
] as const;

/** The three status transitions a playing game can exit through. */
type PlayingExit = 'completed' | 'dropped' | 'backlog';

/**
 * `<playing-list>` — the in-progress view (M3), a deliberately simpler
 * forerunner of the full M4 dashboard. Renders every `playing` {@link UserGame}
 * and exposes the three raw status transitions out of "playing":
 *
 *   [Mark Complete]   → status "completed", stamps `dateCompleted`
 *   [Drop Game]       → status "dropped",   stamps `dateCompleted`
 *   [Back to Backlog] → status "backlog",   clears `dateStarted`, re-queues at
 *                       the end (`sortOrder` = the current backlog length)
 *
 * Each transition stamps its date at the moment of the click (never on load),
 * persists via {@link saveState}, then dispatches a `status-changed`
 * CustomEvent carrying `{ id, newStatus }` — the same pattern `<backlog-list>`'s
 * Start Playing uses (#10). This list re-renders off that event (among the other
 * {@link CHANGE_EVENTS}) so the acted row drops out the instant it's no longer
 * "playing", and a game started from the backlog appears here immediately.
 * Rating and the post-completion ceremony are M4 — these are the raw
 * transitions only.
 *
 * Rendered into light DOM (no shadow root) so the global theme tokens, the
 * `.btn`/`.card` classes, and the global `:focus-visible` ring all apply; its
 * styling lives in `global.css` under `@layer components`, like the backlog
 * list and the timeline — not as Tailwind utilities here. It escapes all
 * interpolated strings since it injects user-entered titles.
 */
class PlayingList extends HTMLElement {
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

  /** Playing user-games, most recently started first (dateAdded as tiebreaker). */
  private playingGames(state: ReturnType<typeof loadState>): UserGame[] {
    return state.userGames
      .filter((userGame) => userGame.status === 'playing')
      .sort(
        (a, b) =>
          (b.dateStarted ?? '').localeCompare(a.dateStarted ?? '') ||
          b.dateAdded.localeCompare(a.dateAdded),
      );
  }

  /** Apply one of the three "playing" exits to a game, stamp the relevant date
   *  at the moment of the click (never on load), persist, then announce
   *  `status-changed`. The acted row leaves on the re-render — it no longer
   *  matches `status === 'playing'`. */
  private transition(id: string, newStatus: PlayingExit) {
    const state = loadState();
    const userGame = state.userGames.find((ug) => ug.id === id);
    if (!userGame) return; // row vanished underneath us — nothing to do

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
        '<p class="playing-empty">No games in progress. Start one from your backlog.</p>';
      return;
    }

    const gamesById = new Map(state.games.map((game) => [game.id, game]));
    const rows = games
      .map((userGame) => this.row(userGame, gamesById.get(userGame.gameId)))
      .join('');
    this.innerHTML = `<ul class="playing-list">${rows}</ul>`;
  }

  private row(userGame: UserGame, game: Game | undefined): string {
    const safeTitle = escapeHtml(game?.title ?? 'Untitled game');

    const platforms = (game?.platforms ?? [])
      .map((name) => `<span class="platform-badge">${escapeHtml(name)}</span>`)
      .join('');
    const platformsBlock = platforms
      ? `<div class="playing-platforms">${platforms}</div>`
      : '';

    return `
      <li class="playing-item card" data-id="${escapeHtml(userGame.id)}">
        <div class="playing-item-main">
          <p class="playing-title">${safeTitle}</p>
          ${platformsBlock}
        </div>
        <div class="playing-actions">
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

if (!customElements.get('playing-list')) {
  customElements.define('playing-list', PlayingList);
}

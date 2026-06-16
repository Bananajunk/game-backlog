import { loadState, saveState } from '../lib/storage';
import type { Game, UserGame } from '../types';

/** State-change events (dispatched on `document`) that should re-render the list. */
const CHANGE_EVENTS = [
  'game-added',
  'game-removed',
  'game-updated',
  'status-changed',
] as const;

/**
 * `<backlog-list>` — the core backlog view (M2). Renders every `backlog`
 * {@link UserGame} as a FIFO queue: `sortOrder` ascending, `dateAdded` as the
 * tiebreaker. Reads from localStorage via the storage helpers and re-renders on
 * any of the {@link CHANGE_EVENTS} so it stays in sync with the add-game form
 * and (later) the edit/delete flows — no full page reload.
 *
 * Rendered into light DOM (no shadow root) so the global theme tokens, the
 * `.btn`/`.card` classes, and the global `:focus-visible` ring all apply; its
 * styling lives in `global.css` under `@layer components`, like the add-game
 * form and the timeline — not as Tailwind utilities here.
 *
 * Scope note: the row renders [Start Playing] | [Edit] | [Remove] as the issue
 * requires, but only the Move Up/Down reordering is wired here. Editing (#8),
 * deletion (#9), and the playing-status transition (a later milestone) attach
 * their behaviour to these buttons in their own issues — wiring them now would
 * front-run that sequenced work.
 */
class BacklogList extends HTMLElement {
  /** Restored after a reorder so keyboard users don't lose their place. */
  private pendingFocus: { id: string; action: 'up' | 'down' } | null = null;

  private readonly onStateChange = () => this.render();

  private readonly onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-action]',
    );
    if (!button) return;
    const id = button.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!id) return;

    // Edit / Remove / Start Playing are owned by sibling issues; ignore for now.
    if (button.dataset.action === 'up') this.move(id, -1);
    else if (button.dataset.action === 'down') this.move(id, 1);
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

  /** Backlog user-games in queue order, newest tiebroken by date added. */
  private backlogQueue(state: ReturnType<typeof loadState>): UserGame[] {
    return state.userGames
      .filter((userGame) => userGame.status === 'backlog')
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.dateAdded.localeCompare(b.dateAdded),
      );
  }

  /** Swap a row's `sortOrder` with its neighbour, persist, and announce it. */
  private move(id: string, direction: -1 | 1) {
    const state = loadState();
    const queue = this.backlogQueue(state);
    const index = queue.findIndex((userGame) => userGame.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= queue.length) return;

    const current = queue[index];
    const neighbour = queue[target];
    const swap = current.sortOrder;
    current.sortOrder = neighbour.sortOrder;
    neighbour.sortOrder = swap;
    saveState(state);

    // The render triggered by `game-updated` (below) consumes this so focus
    // lands back on the button the user just pressed, on its new row.
    this.pendingFocus = { id, action: direction < 0 ? 'up' : 'down' };
    document.dispatchEvent(new CustomEvent('game-updated'));
  }

  private render() {
    const state = loadState();
    const queue = this.backlogQueue(state);

    if (queue.length === 0) {
      this.innerHTML =
        '<p class="backlog-empty">Your backlog is empty. Add a game to get started.</p>';
      this.pendingFocus = null;
      return;
    }

    const gamesById = new Map(state.games.map((game) => [game.id, game]));
    const rows = queue
      .map((userGame, index) =>
        this.row(userGame, gamesById.get(userGame.gameId), index, queue.length),
      )
      .join('');
    this.innerHTML = `<ul class="backlog-list">${rows}</ul>`;

    this.restoreFocus();
  }

  private row(
    userGame: UserGame,
    game: Game | undefined,
    index: number,
    total: number,
  ): string {
    const title = game?.title ?? 'Untitled game';
    const safeTitle = escapeHtml(title);

    const platforms = (game?.platforms ?? [])
      .map((name) => `<span class="platform-badge">${escapeHtml(name)}</span>`)
      .join('');
    const platformsBlock = platforms
      ? `<div class="backlog-platforms">${platforms}</div>`
      : '';

    const moveUp =
      index > 0
        ? `<button type="button" class="btn-icon" data-action="up" aria-label="Move ${safeTitle} up">↑</button>`
        : '';
    const moveDown =
      index < total - 1
        ? `<button type="button" class="btn-icon" data-action="down" aria-label="Move ${safeTitle} down">↓</button>`
        : '';

    return `
      <li class="backlog-item card" data-id="${escapeHtml(userGame.id)}">
        <div class="backlog-item-main">
          <p class="backlog-title">${safeTitle}</p>
          ${platformsBlock}
          <p class="backlog-added">${escapeHtml(relativeAdded(userGame.dateAdded))}</p>
        </div>
        <div class="backlog-controls">
          <div class="backlog-reorder">${moveUp}${moveDown}</div>
          <div class="backlog-actions">
            <button type="button" class="btn btn-secondary" data-action="start">Start Playing</button>
            <button type="button" class="btn btn-secondary" data-action="edit">Edit</button>
            <button type="button" class="btn btn-secondary" data-action="remove">Remove</button>
          </div>
        </div>
      </li>`;
  }

  /** Move focus back onto the just-pressed reorder button after a re-render. */
  private restoreFocus() {
    const focus = this.pendingFocus;
    this.pendingFocus = null;
    if (!focus) return;

    const row = this.querySelector<HTMLElement>(`[data-id="${focus.id}"]`);
    if (!row) return;
    // The button may have vanished (e.g. ↑ on the new first row) — fall back to
    // the other reorder button so focus stays on the moved item.
    const button =
      row.querySelector<HTMLElement>(`[data-action="${focus.action}"]`) ??
      row.querySelector<HTMLElement>('.backlog-reorder [data-action]');
    button?.focus();
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

/** Human-readable "Added N <unit> ago" relative to now. */
function relativeAdded(dateAdded: string): string {
  const days = Math.floor(
    (Date.now() - new Date(dateAdded).getTime()) / 86_400_000,
  );
  if (days <= 0) return 'Added today';
  if (days === 1) return 'Added 1 day ago';
  if (days < 7) return `Added ${days} days ago`;
  if (days < 14) return 'Added 1 week ago';
  if (days < 30) return `Added ${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return 'Added 1 month ago';
  if (days < 365) return `Added ${Math.floor(days / 30)} months ago`;
  if (days < 730) return 'Added 1 year ago';
  return `Added ${Math.floor(days / 365)} years ago`;
}

if (!customElements.get('backlog-list')) {
  customElements.define('backlog-list', BacklogList);
}

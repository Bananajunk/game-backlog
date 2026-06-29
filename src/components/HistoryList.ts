import { loadState, saveState } from '../lib/storage';
import type { Game, UserGame } from '../types';

/** State-change events (dispatched on `document`) that should re-render the list. */
const CHANGE_EVENTS = [
  'game-added',
  'game-removed',
  'game-updated',
  'status-changed',
] as const;

/** Month names for the "Month YYYY" completed-date label, read in UTC so the
 *  rendered month never drifts across the viewer's timezone. */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * `<history-list>` — the archive view (M3) for games that have left the active
 * flow: every `completed` or `dropped` {@link UserGame}, most recently finished
 * first (`dateCompleted` descending, `dateAdded` as the tiebreaker). Preserved
 * and visible but out of the way, so the backlog and playing views stay focused
 * on what's live.
 *
 * Each row shows the title, a status badge, the platform(s), the completion
 * month, the rating, and a single [Restore to Backlog] action. The status badge
 * carries its meaning four ways at once — marker SHAPE (hollow circle =
 * completed, square = dropped) + GLYPH (✓ / ✕) + text LABEL + colour — per the
 * accessibility invariant in CLAUDE.md, never colour alone.
 *
 * [Restore to Backlog] is reversible (it just re-queues the game), so instead of
 * the destructive `<dialog>` the backlog list uses for deletes (#9), it shows a
 * lightweight **inline** confirmation in place of the row's actions: "<Title>
 * will be moved back to your backlog. [Confirm] [Cancel]". Confirm flips the
 * game to `backlog`, clears its `dateStarted`/`dateCompleted`, and re-queues it
 * at the end (`sortOrder` = the current backlog length, mirroring how
 * `<add-game-form>` and `<playing-list>`'s Back-to-Backlog append), then
 * persists and dispatches a `status-changed` CustomEvent carrying
 * `{ id, newStatus: "backlog" }`. The list re-renders off that event (among the
 * other {@link CHANGE_EVENTS}) so the restored row drops out immediately and the
 * backlog view picks it up.
 *
 * Rendered into light DOM (no shadow root) so the global theme tokens, the
 * `.btn`/`.card` classes, the `.status-chip` styling, and the global
 * `:focus-visible` ring all apply; its own styling lives in `global.css` under
 * `@layer components`, like the backlog and playing lists — not as Tailwind
 * utilities here. It escapes all interpolated strings since it injects
 * user-entered titles.
 */
class HistoryList extends HTMLElement {
  /** The single row showing its inline restore confirmation, by `UserGame.id`,
   *  or null. Only one row confirms at a time (like the backlog edit form). */
  private confirmingId: string | null = null;

  /** Where focus should land after the next render (keyboard users keep their
   *  place across the confirm/cancel re-render). */
  private pendingFocus:
    | { kind: 'confirm'; id: string } // the Confirm button, on opening the prompt
    | { kind: 'restoreButton'; id: string } // the [Restore] button, on cancel
    | null = null;

  private readonly onStateChange = () => this.render();

  private readonly onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-action]',
    );
    if (!button) return;
    const id = button.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!id) return;

    switch (button.dataset.action) {
      case 'restore':
        this.startConfirm(id);
        break;
      case 'confirm-restore':
        this.restore(id);
        break;
      case 'cancel-restore':
        this.cancelConfirm(id);
        break;
    }
  };

  /** Escape dismisses the open inline confirmation (mirrors the backlog edit). */
  private readonly onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || this.confirmingId === null) return;
    event.preventDefault();
    this.cancelConfirm(this.confirmingId);
  };

  connectedCallback() {
    this.addEventListener('click', this.onClick);
    this.addEventListener('keydown', this.onKeydown);
    for (const name of CHANGE_EVENTS) {
      document.addEventListener(name, this.onStateChange);
    }
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('keydown', this.onKeydown);
    for (const name of CHANGE_EVENTS) {
      document.removeEventListener(name, this.onStateChange);
    }
  }

  /** Completed + dropped user-games, most recently finished first
   *  (`dateAdded` breaks ties when two share a completion date). */
  private historyGames(state: ReturnType<typeof loadState>): UserGame[] {
    return state.userGames
      .filter(
        (userGame) =>
          userGame.status === 'completed' || userGame.status === 'dropped',
      )
      .sort(
        (a, b) =>
          (b.dateCompleted ?? '').localeCompare(a.dateCompleted ?? '') ||
          b.dateAdded.localeCompare(a.dateAdded),
      );
  }

  /** Open the inline restore confirmation for a row. Only one at a time:
   *  setting `confirmingId` replaces any other, so opening it on row B closes
   *  row A. No state changes, so render directly. */
  private startConfirm(id: string) {
    this.confirmingId = id;
    this.pendingFocus = { kind: 'confirm', id };
    this.render();
  }

  /** Dismiss the confirmation without restoring; focus returns to [Restore]. */
  private cancelConfirm(id: string) {
    this.confirmingId = null;
    this.pendingFocus = { kind: 'restoreButton', id };
    this.render();
  }

  /** Re-queue a completed/dropped game at the back of the backlog: flip its
   *  status, clear the started/completed stamps, and set `sortOrder` to the
   *  current backlog length (this game isn't `backlog`, so it's excluded from
   *  that count) — mirroring how `<add-game-form>` and `<playing-list>`'s
   *  Back-to-Backlog append. Persist, then announce `status-changed`; the row
   *  leaves on the re-render. */
  private restore(id: string) {
    const state = loadState();
    const userGame = state.userGames.find((ug) => ug.id === id);
    if (!userGame) return; // row vanished underneath us — nothing to do

    const backlogLength = state.userGames.filter(
      (ug) => ug.status === 'backlog',
    ).length;
    userGame.status = 'backlog';
    userGame.dateStarted = undefined;
    userGame.dateCompleted = undefined;
    userGame.sortOrder = backlogLength;
    saveState(state);

    this.confirmingId = null;
    this.pendingFocus = null; // the row is leaving — nothing to refocus
    document.dispatchEvent(
      new CustomEvent('status-changed', {
        detail: { id: userGame.id, newStatus: 'backlog' },
      }),
    );
  }

  private render() {
    const state = loadState();
    const games = this.historyGames(state);

    if (games.length === 0) {
      this.innerHTML =
        '<p class="history-empty">No completed games yet. Finish something!</p>';
      this.confirmingId = null;
      this.pendingFocus = null;
      return;
    }

    const gamesById = new Map(state.games.map((game) => [game.id, game]));
    const rows = games
      .map((userGame) => this.row(userGame, gamesById.get(userGame.gameId)))
      .join('');
    this.innerHTML = `<ul class="history-list">${rows}</ul>`;

    this.restoreFocus();
  }

  private row(userGame: UserGame, game: Game | undefined): string {
    const safeTitle = escapeHtml(game?.title ?? 'Untitled game');

    const platforms = (game?.platforms ?? [])
      .map((name) => `<span class="platform-badge">${escapeHtml(name)}</span>`)
      .join('');
    const platformsBlock = platforms
      ? `<div class="history-platforms">${platforms}</div>`
      : '';

    const date = formatMonthYear(userGame.dateCompleted);
    const rating = formatRating(userGame.rating);

    // The action area is either the [Restore] button or, while this row is
    // confirming, the inline "<Title> will be moved back…" prompt.
    const actions =
      userGame.id === this.confirmingId
        ? `
          <div class="history-confirm" role="group" aria-label="Confirm restore to backlog">
            <p class="history-confirm-msg">${safeTitle} will be moved back to your backlog.</p>
            <div class="history-confirm-actions">
              <button type="button" class="btn btn-primary" data-action="confirm-restore">Confirm</button>
              <button type="button" class="btn btn-secondary" data-action="cancel-restore">Cancel</button>
            </div>
          </div>`
        : `
          <div class="history-actions">
            <button type="button" class="btn btn-secondary" data-action="restore">Restore to Backlog</button>
          </div>`;

    return `
      <li class="history-item card" data-id="${escapeHtml(userGame.id)}" data-status="${userGame.status}">
        <div class="history-item-main">
          <p class="history-title">${safeTitle}</p>
          ${this.statusBadge(userGame.status === 'completed' ? 'completed' : 'dropped')}
          ${platformsBlock}
          <p class="history-meta">
            <span class="history-date num">${escapeHtml(date)}</span>
            <span class="history-rating num">${escapeHtml(rating)}</span>
          </p>
        </div>
        ${actions}
      </li>`;
  }

  /** The four-signal status badge: a shape marker (hollow circle = completed,
   *  square = dropped) + an SVG glyph (✓ / ✕) + a text label, coloured by the
   *  `data-status` on the row. Shape, glyph, and label each carry the state on
   *  their own, so colour is never the only signal (CLAUDE.md invariant). */
  private statusBadge(status: 'completed' | 'dropped'): string {
    const glyph =
      status === 'completed'
        ? '<path d="M5 12.5l4.5 4.5L19 7" />'
        : '<path d="M6 6l12 12M18 6L6 18" />';
    const label = status === 'completed' ? 'Completed' : 'Dropped';
    return `
          <span class="history-status">
            <span class="history-marker" aria-hidden="true"></span>
            <span class="status-chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph}</svg>
              ${label}
            </span>
          </span>`;
  }

  /** Place focus where the last interaction left off after a re-render. */
  private restoreFocus() {
    const focus = this.pendingFocus;
    this.pendingFocus = null;
    if (!focus) return;

    const row = this.querySelector<HTMLElement>(`[data-id="${focus.id}"]`);
    if (!row) return;

    const selector =
      focus.kind === 'confirm'
        ? '[data-action="confirm-restore"]'
        : '[data-action="restore"]';
    row.querySelector<HTMLElement>(selector)?.focus();
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

/** Format an ISO timestamp as "Month YYYY" (e.g. "March 2026"), read in UTC so
 *  the month matches the stored instant regardless of the viewer's timezone.
 *  Returns "—" when the date is missing or unparseable. */
function formatMonthYear(iso: string | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Format a 1–10 rating as "N/10", or "—" when the game was never rated. */
function formatRating(rating: number | undefined): string {
  return typeof rating === 'number' ? `${rating}/10` : '—';
}

if (!customElements.get('history-list')) {
  customElements.define('history-list', HistoryList);
}

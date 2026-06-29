import { PLATFORMS } from '../lib/platforms';
import { loadState, saveState } from '../lib/storage';
import type { Game, UserGame } from '../types';

/** State-change events (dispatched on `document`) that should re-render the list. */
const CHANGE_EVENTS = [
  'game-added',
  'game-removed',
  'game-updated',
  'status-changed',
] as const;

/** Active-game count at or above which [Start Playing] shows a friction warning
 *  before starting, rather than starting immediately (#14). "Active" = playing. */
const ACTIVE_WARNING_THRESHOLD = 3;

/** In-progress edit values, captured from the live DOM across re-renders. */
type EditDraft = { title: string; platforms: string[] };

/** Where focus should land after the next render. */
type PendingFocus =
  | { kind: 'reorder'; id: string; action: 'up' | 'down' }
  | { kind: 'edit'; id: string } // the title input, on entering edit mode
  | { kind: 'editButton'; id: string } // the [Edit] button, on exiting it
  | { kind: 'confirmStart'; id: string } // [Continue Anyway], on opening the warning
  | { kind: 'startButton'; id: string }; // [Start Playing], on cancelling it

/**
 * `<backlog-list>` — the core backlog view (M2). Renders every `backlog`
 * {@link UserGame} as a FIFO queue: `sortOrder` ascending, `dateAdded` as the
 * tiebreaker. Reads from localStorage via the storage helpers and re-renders on
 * any of the {@link CHANGE_EVENTS} so it stays in sync with the add-game form
 * and the edit/delete flows — no full page reload.
 *
 * Rendered into light DOM (no shadow root) so the global theme tokens, the
 * `.btn`/`.card` classes, and the global `:focus-visible` ring all apply; its
 * styling lives in `global.css` under `@layer components`, like the add-game
 * form and the timeline — not as Tailwind utilities here.
 *
 * Scope note: the row renders [Start Playing] | [Edit] | [Remove].
 * [Start Playing] flips the game's status to "playing" and stamps `dateStarted`
 * at the moment of the click, then fires `status-changed` so the row leaves the
 * queue immediately and the playing view (M4) can pick it up (#10) — unless
 * {@link ACTIVE_WARNING_THRESHOLD} or more games are already active, in which
 * case it first shows an inline friction warning in place of the row's controls
 * ([Continue Anyway] starts anyway, [Cancel] keeps the game in the backlog) so
 * the app discourages, without blocking, piling up active games (#14). [Edit]
 * transforms the row into an inline edit form (#8); [Remove] opens a
 * `<dialog role="alertdialog">` confirmation before deleting (#9).
 */
class BacklogList extends HTMLElement {
  /** Restored after a reorder/edit so keyboard users don't lose their place. */
  private pendingFocus: PendingFocus | null = null;

  /** The single row currently in edit mode, by `UserGame.id`, or null. */
  private editingId: string | null = null;

  /** The single row showing its [Start Playing] friction warning, by
   *  `UserGame.id`, or null. Only one warns at a time. */
  private warningId: string | null = null;

  /** The active-game count captured when the warning opened, shown in its text. */
  private warningCount = 0;

  /** Reusable confirmation dialog (lazily built, kept in `document.body` so the
   *  list's `innerHTML` re-renders can never wipe or move it). */
  private dialog: HTMLDialogElement | null = null;
  private dialogTitle: HTMLElement | null = null;

  /** The [Remove] button that opened the dialog — focus returns here on close. */
  private removeTrigger: HTMLElement | null = null;

  /** The `UserGame` queued for deletion while the dialog is open. */
  private pendingRemovalId: string | null = null;

  private readonly onStateChange = () => this.render();

  private readonly onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-action]',
    );
    if (!button) return;
    const id = button.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (!id) return;

    // Save is a submit button, handled in onSubmit (so Enter works too).
    switch (button.dataset.action) {
      case 'start':
        this.requestStart(id);
        break;
      case 'confirm-start':
        this.performStart(id);
        break;
      case 'cancel-start':
        this.cancelStart(id);
        break;
      case 'up':
        this.move(id, -1);
        break;
      case 'down':
        this.move(id, 1);
        break;
      case 'edit':
        this.startEdit(id);
        break;
      case 'cancel':
        this.cancelEdit(id);
        break;
      case 'remove':
        this.confirmRemove(id, button);
        break;
    }
  };

  /** Save the edit on submit — fired by the [Save] button or Enter in the title. */
  private readonly onSubmit = (event: Event) => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>(
      'form.backlog-edit',
    );
    if (!form) return;
    event.preventDefault();
    const id = form.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (id) this.saveEdit(id);
  };

  /** Escape cancels the open edit form, or the open friction warning. */
  private readonly onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (this.editingId !== null) {
      event.preventDefault();
      this.cancelEdit(this.editingId);
    } else if (this.warningId !== null) {
      event.preventDefault();
      this.cancelStart(this.warningId);
    }
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
    // The dialog lives in `document.body`, so tear it down with the element.
    this.dialog?.remove();
    this.dialog = null;
    this.dialogTitle = null;
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
    this.pendingFocus = { kind: 'reorder', id, action: direction < 0 ? 'up' : 'down' };
    document.dispatchEvent(new CustomEvent('game-updated'));
  }

  /** [Start Playing] entry point (#14). The app discourages — but never blocks —
   *  piling up active games: if {@link ACTIVE_WARNING_THRESHOLD} or more are
   *  already "playing", show an inline friction warning in this row instead of
   *  starting, leaving the user to [Continue Anyway] or [Cancel]. Below the
   *  threshold it starts immediately, no warning. */
  private requestStart(id: string) {
    const state = loadState();
    const playingCount = state.userGames.filter(
      (ug) => ug.status === 'playing',
    ).length;

    if (playingCount >= ACTIVE_WARNING_THRESHOLD) {
      this.warningId = id;
      this.warningCount = playingCount;
      this.pendingFocus = { kind: 'confirmStart', id };
      this.render(); // nothing persisted yet — render directly, not via an event
      return;
    }
    this.performStart(id);
  }

  /** Dismiss the friction warning without starting; the game stays in the
   *  backlog and focus returns to its [Start Playing] button. */
  private cancelStart(id: string) {
    this.warningId = null;
    this.warningCount = 0;
    this.pendingFocus = { kind: 'startButton', id };
    this.render();
  }

  /** Move a backlog game into "playing": flip its status and stamp `dateStarted`
   *  at the moment of the click (never on load), persist, then announce
   *  `status-changed`. The list re-renders off that event and drops the row
   *  (it no longer matches `status === 'backlog'`); the playing view (M4) is the
   *  other listener. Reached either directly (below the threshold) or via the
   *  warning's [Continue Anyway]. */
  private performStart(id: string) {
    const state = loadState();
    const userGame = state.userGames.find((ug) => ug.id === id);
    if (!userGame) return; // row vanished underneath us — nothing to do

    userGame.status = 'playing';
    userGame.dateStarted = new Date().toISOString();
    saveState(state);

    // Clear any warning we were showing for this row before it leaves the queue.
    this.warningId = null;
    this.warningCount = 0;
    document.dispatchEvent(
      new CustomEvent('status-changed', {
        detail: { id: userGame.id, newStatus: 'playing' },
      }),
    );
  }

  /** Switch a row into edit mode. Only one at a time: setting `editingId`
   *  replaces any other, so opening edit on row B closes row A. */
  private startEdit(id: string) {
    this.editingId = id;
    this.pendingFocus = { kind: 'edit', id };
    this.render();
  }

  /** Leave edit mode without saving; focus returns to the [Edit] button. */
  private cancelEdit(id: string) {
    this.editingId = null;
    this.pendingFocus = { kind: 'editButton', id };
    this.render(); // no state changed, so render directly rather than via event
  }

  /** Persist the edited title/platforms, then return the row to display mode. */
  private saveEdit(id: string) {
    const state = loadState();
    const userGame = state.userGames.find((ug) => ug.id === id);
    const game = userGame
      ? state.games.find((g) => g.id === userGame.gameId)
      : undefined;
    if (!game) {
      this.cancelEdit(id); // row vanished underneath us — just exit cleanly
      return;
    }

    const row = this.querySelector<HTMLElement>(`[data-id="${id}"]`);
    const titleInput = row?.querySelector<HTMLInputElement>(
      'input[name="title"]',
    );
    const title = titleInput?.value.trim() ?? '';

    // Mirror the add-game form: refuse a blank title, keep editing, surface the
    // inline error (glyph + words + role="alert" carry it, never colour alone).
    if (!title) {
      const error = row?.querySelector<HTMLElement>('.form-error');
      if (error) error.hidden = false;
      titleInput?.setAttribute('aria-invalid', 'true');
      titleInput?.focus();
      return;
    }

    const platforms = Array.from(
      row?.querySelectorAll<HTMLInputElement>(
        'input[name="platform"]:checked',
      ) ?? [],
    ).map((input) => input.value);

    game.title = title;
    game.platforms = platforms;
    saveState(state);

    this.editingId = null;
    this.pendingFocus = { kind: 'editButton', id };
    document.dispatchEvent(new CustomEvent('game-updated'));
  }

  /** Open the deletion confirmation for a row's [Remove] button. Nothing is
   *  removed until the user confirms — see {@link performRemove}. The native
   *  modal `<dialog>` gives focus trapping (Tab/Shift+Tab cycle only its
   *  buttons) and Escape-to-dismiss for free — no library, no `confirm()`. */
  private confirmRemove(id: string, trigger: HTMLElement) {
    const state = loadState();
    const userGame = state.userGames.find((ug) => ug.id === id);
    const game = userGame
      ? state.games.find((g) => g.id === userGame.gameId)
      : undefined;

    const dialog = this.ensureDialog();
    this.removeTrigger = trigger;
    this.pendingRemovalId = id;
    // textContent (not innerHTML) keeps the user-entered title injection-safe.
    this.dialogTitle!.textContent = `Remove ${game?.title ?? 'this game'}?`;
    dialog.showModal();
  }

  /** Build the single reusable confirmation dialog the first time it's needed
   *  and wire its buttons. Appended to `document.body` so the list re-rendering
   *  its own `innerHTML` never detaches it. */
  private ensureDialog(): HTMLDialogElement {
    if (this.dialog) return this.dialog;

    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'dialog-title');
    dialog.innerHTML = `
      <h2 id="dialog-title" class="confirm-dialog-title"></h2>
      <p class="confirm-dialog-body">
        This will permanently remove the game from your backlog.
      </p>
      <div class="confirm-dialog-actions">
        <button type="button" class="btn btn-secondary" data-dialog="cancel">Cancel</button>
        <button type="button" class="btn btn-danger" data-dialog="confirm">Confirm Remove</button>
      </div>`;

    // Confirm deletes then closes; Cancel just closes. Escape is handled
    // natively (fires `cancel`, then `close`), so it needs no extra wiring.
    dialog.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-dialog]',
      )?.dataset.dialog;
      if (action === 'confirm') {
        this.performRemove();
        dialog.close();
      } else if (action === 'cancel') {
        dialog.close();
      }
    });

    // One place restores focus, covering Cancel, Escape, and Confirm alike. On
    // a confirmed removal the trigger's row is already gone, so only refocus
    // when the button still exists (the cancel/Escape paths).
    dialog.addEventListener('close', () => {
      this.pendingRemovalId = null;
      const trigger = this.removeTrigger;
      this.removeTrigger = null;
      if (trigger && this.contains(trigger)) trigger.focus();
    });

    this.dialogTitle = dialog.querySelector<HTMLElement>('#dialog-title');
    document.body.appendChild(dialog);
    this.dialog = dialog;
    return dialog;
  }

  /** Delete the queued `UserGame`, drop its `Game` if now orphaned, persist, and
   *  announce `game-removed` so every view re-renders. */
  private performRemove() {
    const id = this.pendingRemovalId;
    if (!id) return;

    const state = loadState();
    const userGame = state.userGames.find((ug) => ug.id === id);
    if (!userGame) return; // already gone — nothing to do

    const { gameId } = userGame;
    state.userGames = state.userGames.filter((ug) => ug.id !== id);
    // Remove the linked Game only if no other UserGame still references it.
    if (!state.userGames.some((ug) => ug.gameId === gameId)) {
      state.games = state.games.filter((g) => g.id !== gameId);
    }
    saveState(state);
    document.dispatchEvent(new CustomEvent('game-removed'));
  }

  private render() {
    // Capture any in-progress edit before the rebuild discards the form, so an
    // external re-render (e.g. a reorder on another row) keeps what was typed.
    const draft = this.captureDraft();

    const state = loadState();
    const queue = this.backlogQueue(state);

    if (queue.length === 0) {
      this.innerHTML =
        '<p class="backlog-empty">Your backlog is empty. Add a game to get started.</p>';
      this.editingId = null;
      this.warningId = null;
      this.warningCount = 0;
      this.pendingFocus = null;
      return;
    }

    const gamesById = new Map(state.games.map((game) => [game.id, game]));
    const rows = queue
      .map((userGame, index) => {
        const game = gamesById.get(userGame.gameId);
        return userGame.id === this.editingId
          ? this.editRow(userGame, game, draft)
          : this.row(userGame, game, index, queue.length);
      })
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

    // While this row is warning (too many active games), its controls give way
    // to the inline friction prompt — the same "swap the action region" idiom
    // the history list uses for its restore confirmation.
    const controls =
      userGame.id === this.warningId
        ? this.warningBanner(this.warningCount)
        : `
        <div class="backlog-controls">
          <div class="backlog-reorder">${moveUp}${moveDown}</div>
          <div class="backlog-actions">
            <button type="button" class="btn btn-secondary" data-action="start">Start Playing</button>
            <button type="button" class="btn btn-secondary" data-action="edit">Edit</button>
            <button type="button" class="btn btn-secondary" data-action="remove">Remove</button>
          </div>
        </div>`;

    return `
      <li class="backlog-item card" data-id="${escapeHtml(userGame.id)}">
        <div class="backlog-item-main">
          <p class="backlog-title">${safeTitle}</p>
          ${platformsBlock}
          <p class="backlog-added">${escapeHtml(relativeAdded(userGame.dateAdded))}</p>
        </div>
        ${controls}
      </li>`;
  }

  /** The inline friction warning (#14), shown in place of a row's controls when
   *  the user tries to start a game while {@link ACTIVE_WARNING_THRESHOLD}+ are
   *  already active. Not a modal — it renders right in the backlog row. The ⚠
   *  glyph and the wording carry the warning, never colour alone (the CLAUDE.md
   *  invariant); `role="alert"` announces it when it appears. [Continue Anyway]
   *  starts the game regardless; [Cancel] leaves it in the backlog. `count` is a
   *  number (≥ the threshold), so it needs no escaping. */
  private warningBanner(count: number): string {
    return `
        <div class="backlog-warning" role="group" aria-label="Too many active games">
          <p class="backlog-warning-msg" role="alert">
            <span class="backlog-warning-icon" aria-hidden="true">⚠</span>
            <span>You already have ${count} games active. Starting another is allowed, but this app works best when you finish one first.</span>
          </p>
          <div class="backlog-warning-actions">
            <button type="button" class="btn btn-primary" data-action="confirm-start">Continue Anyway</button>
            <button type="button" class="btn btn-secondary" data-action="cancel-start">Cancel</button>
          </div>
        </div>`;
  }

  /** The same row, transformed into an inline edit form (#8). Pre-filled from
   *  the captured draft if present, otherwise from the stored game. */
  private editRow(
    userGame: UserGame,
    game: Game | undefined,
    draft: EditDraft | null,
  ): string {
    const title = draft ? draft.title : (game?.title ?? '');
    const selected = new Set(draft ? draft.platforms : (game?.platforms ?? []));
    const titleId = `edit-${userGame.id}-title`;
    const errorId = `edit-${userGame.id}-error`;

    // Offer the canonical options plus any existing platform not among them, so
    // a non-standard platform is never silently dropped when the user saves.
    const options = [
      ...PLATFORMS,
      ...[...selected].filter(
        (name) => !(PLATFORMS as readonly string[]).includes(name),
      ),
    ];

    const platforms = options
      .map((name) => {
        const checked = selected.has(name) ? ' checked' : '';
        return `
            <label class="platform">
              <input type="checkbox" name="platform" value="${escapeHtml(name)}"${checked} />
              <span>${escapeHtml(name)}</span>
            </label>`;
      })
      .join('');

    return `
      <li class="backlog-item card" data-id="${escapeHtml(userGame.id)}">
        <form class="backlog-edit" novalidate>
          <div class="field">
            <label for="${titleId}">Title</label>
            <input
              id="${titleId}"
              name="title"
              type="text"
              value="${escapeHtml(title)}"
              required
              autocomplete="off"
              aria-describedby="${errorId}"
            />
            <p id="${errorId}" class="form-error" role="alert" hidden>
              <span aria-hidden="true">⚠</span> Enter a title to save.
            </p>
          </div>

          <fieldset class="field">
            <legend>Platforms</legend>
            <div class="platforms">${platforms}</div>
          </fieldset>

          <div class="backlog-edit-actions">
            <button type="submit" class="btn btn-primary" data-action="save">Save</button>
            <button type="button" class="btn btn-secondary" data-action="cancel">Cancel</button>
          </div>
        </form>
      </li>`;
  }

  /** Read the live edit-form values, or null when no row is being edited. */
  private captureDraft(): EditDraft | null {
    if (!this.editingId) return null;
    const row = this.querySelector<HTMLElement>(
      `[data-id="${this.editingId}"]`,
    );
    const titleInput = row?.querySelector<HTMLInputElement>(
      'input[name="title"]',
    );
    if (!titleInput) return null; // not yet in edit mode (display row still shown)
    return {
      title: titleInput.value,
      platforms: Array.from(
        row!.querySelectorAll<HTMLInputElement>(
          'input[name="platform"]:checked',
        ),
      ).map((input) => input.value),
    };
  }

  /** Place focus where the last interaction left off after a re-render. */
  private restoreFocus() {
    const focus = this.pendingFocus;
    this.pendingFocus = null;
    if (!focus) return;

    const row = this.querySelector<HTMLElement>(`[data-id="${focus.id}"]`);
    if (!row) return;

    if (focus.kind === 'edit') {
      row.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
      return;
    }
    if (focus.kind === 'editButton') {
      row.querySelector<HTMLElement>('[data-action="edit"]')?.focus();
      return;
    }
    if (focus.kind === 'confirmStart') {
      row.querySelector<HTMLElement>('[data-action="confirm-start"]')?.focus();
      return;
    }
    if (focus.kind === 'startButton') {
      row.querySelector<HTMLElement>('[data-action="start"]')?.focus();
      return;
    }
    // Reorder: the button may have vanished (e.g. ↑ on the new first row) — fall
    // back to the other reorder button so focus stays on the moved item.
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

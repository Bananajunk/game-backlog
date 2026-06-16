import { generateId, loadState, saveState } from '../lib/storage';
import type { Game, UserGame } from '../types';

/** Platforms offered as checkboxes, in display order. */
const PLATFORMS = [
  'PC',
  'PS5',
  'PS4',
  'Xbox Series X',
  'Xbox One',
  'Nintendo Switch',
  'Mobile',
  'Other',
] as const;

/** Per-instance counter so label `for`/`id` pairs stay unique on the page. */
let instanceCount = 0;

/**
 * `<add-game-form>` — manual game entry for the backlog (M2, pre-IGDB).
 *
 * Astro components render statically, so anything that writes state needs a
 * custom element. On submit this appends a {@link Game} plus a `backlog`
 * {@link UserGame} to localStorage via the storage helpers, then announces the
 * change with a `game-added` event on `document` so other views can re-render.
 *
 * Rendered into light DOM (no shadow root) so the global theme tokens, the
 * `.btn`/`.card` component classes, and the global `:focus-visible` ring all
 * apply. Validation is handled in JS (`novalidate`) so the empty-title case
 * shows our own inline error instead of the browser's native bubble; the
 * `required` attribute is kept for semantics and assistive tech.
 */
class AddGameForm extends HTMLElement {
  connectedCallback() {
    // connectedCallback can fire more than once if the node is moved; render
    // only the first time so listeners aren't attached twice.
    if (this.dataset.ready) return;
    this.dataset.ready = 'true';

    const uid = `agf-${(instanceCount += 1)}`;
    this.innerHTML = this.template(uid);
    this.querySelector('form')!.addEventListener('submit', (event) =>
      this.handleSubmit(event),
    );
  }

  private template(uid: string): string {
    const platforms = PLATFORMS.map(
      (name) => `
          <label class="platform">
            <input type="checkbox" name="platform" value="${name}" />
            <span>${name}</span>
          </label>`,
    ).join('');

    return `
      <form class="card add-game-form" novalidate>
        <div class="field">
          <label for="${uid}-title">Title</label>
          <input
            id="${uid}-title"
            name="title"
            type="text"
            required
            autocomplete="off"
            aria-describedby="${uid}-error"
          />
          <p id="${uid}-error" class="form-error" role="alert" hidden>
            <span aria-hidden="true">⚠</span> Enter a title to add a game.
          </p>
        </div>

        <fieldset class="field">
          <legend>Platforms</legend>
          <div class="platforms">${platforms}</div>
        </fieldset>

        <div class="field">
          <label for="${uid}-year">
            Release year <span class="field-optional">(optional)</span>
          </label>
          <input
            id="${uid}-year"
            name="year"
            type="number"
            min="1970"
            max="2030"
            inputmode="numeric"
          />
        </div>

        <button type="submit" class="btn btn-primary">Add to Backlog</button>
      </form>`;
  }

  private handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const titleInput = form.querySelector<HTMLInputElement>(
      'input[name="title"]',
    )!;
    const yearInput = form.querySelector<HTMLInputElement>(
      'input[name="year"]',
    )!;
    const error = form.querySelector<HTMLElement>('.form-error')!;

    const title = titleInput.value.trim();
    if (!title) {
      error.hidden = false;
      titleInput.setAttribute('aria-invalid', 'true');
      titleInput.focus();
      return;
    }
    error.hidden = true;
    titleInput.removeAttribute('aria-invalid');

    const platforms = Array.from(
      form.querySelectorAll<HTMLInputElement>(
        'input[name="platform"]:checked',
      ),
    ).map((input) => input.value);

    const yearValue = yearInput.value.trim();
    const year = yearValue ? Number(yearValue) : undefined;

    const game: Game = {
      id: generateId(),
      title,
      platforms,
      releaseDate: year ? `${year}-01-01` : undefined,
    };

    const state = loadState();
    const backlogCount = state.userGames.filter(
      (userGame) => userGame.status === 'backlog',
    ).length;

    const userGame: UserGame = {
      id: generateId(),
      gameId: game.id,
      status: 'backlog',
      dateAdded: new Date().toISOString(),
      sortOrder: backlogCount,
    };

    state.games.push(game);
    state.userGames.push(userGame);
    saveState(state);

    document.dispatchEvent(new CustomEvent('game-added'));

    form.reset();
    titleInput.focus();
  }
}

if (!customElements.get('add-game-form')) {
  customElements.define('add-game-form', AddGameForm);
}

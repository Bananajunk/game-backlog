import type { AppState } from '../types';
import { createSeedState } from './seedData';

const STORAGE_KEY = 'backlog-app-v1';
const INIT_KEY = 'backlog-initialized';

/**
 * Load app state from localStorage. Returns empty state on any error — never
 * throws. On a fresh browser (no stored state and not yet initialized) it seeds
 * realistic demo data exactly once, guarded by the {@link INIT_KEY} flag.
 */
export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.games) || !Array.isArray(parsed?.userGames)) {
        return emptyState();
      }
      return parsed as AppState;
    }
    // No stored state. Seed demo data once per browser; the init flag prevents
    // re-seeding after the user has deliberately emptied their backlog.
    if (!localStorage.getItem(INIT_KEY)) {
      const seed = createSeedState();
      saveState(seed);
      localStorage.setItem(INIT_KEY, 'true');
      return seed;
    }
    return emptyState();
  } catch {
    return emptyState();
  }
}

/** Persist the full app state. */
export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/** Generate a UUID using the Web Crypto API. */
export function generateId(): string {
  return crypto.randomUUID();
}

function emptyState(): AppState {
  return { games: [], userGames: [] };
}

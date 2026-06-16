import type { AppState } from '../types';

const STORAGE_KEY = 'backlog-app-v1';

/** Load app state from localStorage. Returns empty state on any error — never throws. */
export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.games) || !Array.isArray(parsed?.userGames)) {
      return emptyState();
    }
    return parsed as AppState;
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

import type { AppState, Game, UserGame } from '../types';
import { generateId } from './storage';

/**
 * First-run / development demo data spanning all four statuses, so the UI is
 * never empty and every component can be exercised.
 *
 * All dates are hardcoded ISO strings relative to the anchor `2026-01-01`
 * (the day offset is noted inline, e.g. `anchor +64`). This keeps the seed
 * deterministic — no `Date.now()` — and no network calls; every value is
 * local and fixed.
 */

type SeedEntry = {
  title: string;
  platforms: string[];
  releaseDate: string;
  /** UserGame fields; `id` and `gameId` are filled in by createSeedState. */
  user: Omit<UserGame, 'id' | 'gameId'>;
};

const SEED: SeedEntry[] = [
  // --- Completed: dateStarted + dateCompleted + rating ---
  {
    title: 'Hollow Knight',
    platforms: ['PC'],
    releaseDate: '2017-02-24',
    user: {
      status: 'completed',
      dateAdded: '2026-01-02', // anchor +1
      dateStarted: '2026-01-05', // anchor +4
      dateCompleted: '2026-03-06', // anchor +64
      rating: 9,
      platform: 'PC',
      sortOrder: 0,
    },
  },
  {
    title: 'Hades',
    platforms: ['PC'],
    releaseDate: '2020-09-17',
    user: {
      status: 'completed',
      dateAdded: '2026-02-05', // anchor +35
      dateStarted: '2026-02-10', // anchor +40
      dateCompleted: '2026-04-15', // anchor +104
      rating: 10,
      platform: 'PC',
      sortOrder: 0,
    },
  },
  {
    title: 'Celeste',
    platforms: ['Switch'],
    releaseDate: '2018-01-25',
    user: {
      status: 'completed',
      dateAdded: '2026-03-08', // anchor +66
      dateStarted: '2026-03-12', // anchor +70
      dateCompleted: '2026-05-01', // anchor +120
      rating: 9,
      platform: 'Switch',
      sortOrder: 0,
    },
  },

  // --- Dropped: dateStarted + dateCompleted, no rating ---
  {
    title: 'Cyberpunk 2077',
    platforms: ['PC'],
    releaseDate: '2020-12-10',
    user: {
      status: 'dropped',
      dateAdded: '2026-04-18', // anchor +107
      dateStarted: '2026-04-21', // anchor +110
      dateCompleted: '2026-04-29', // anchor +118 — ~8h played, then dropped
      platform: 'PC',
      sortOrder: 0,
    },
  },

  // --- Playing: dateStarted set ---
  {
    title: 'Elden Ring',
    platforms: ['PS5'],
    releaseDate: '2022-02-25',
    user: {
      status: 'playing',
      dateAdded: '2026-05-28', // anchor +147
      dateStarted: '2026-06-01', // anchor +151 — ~2 weeks ago
      platform: 'PS5',
      sortOrder: 0,
    },
  },
  {
    title: "Baldur's Gate 3",
    platforms: ['PC'],
    releaseDate: '2023-08-03',
    user: {
      status: 'playing',
      dateAdded: '2026-06-02', // anchor +152
      dateStarted: '2026-06-08', // anchor +158 — ~1 week ago
      platform: 'PC',
      sortOrder: 0,
    },
  },

  // --- Backlog: dateAdded + sortOrder set (FIFO queue order) ---
  {
    title: 'Disco Elysium',
    platforms: ['PC'],
    releaseDate: '2019-10-15',
    user: { status: 'backlog', dateAdded: '2026-05-21', sortOrder: 0 }, // anchor +140
  },
  {
    title: 'Outer Wilds',
    platforms: ['PC'],
    releaseDate: '2019-05-28',
    user: { status: 'backlog', dateAdded: '2026-05-23', sortOrder: 1 }, // anchor +142
  },
  {
    title: 'Return of the Obra Dinn',
    platforms: ['PC'],
    releaseDate: '2018-10-18',
    user: { status: 'backlog', dateAdded: '2026-05-26', sortOrder: 2 }, // anchor +145
  },
  {
    title: 'The Witcher 3',
    platforms: ['PC'],
    releaseDate: '2015-05-19',
    user: { status: 'backlog', dateAdded: '2026-05-31', sortOrder: 3 }, // anchor +150
  },
  {
    title: 'Ori and the Blind Forest',
    platforms: ['PC'],
    releaseDate: '2015-03-11',
    user: { status: 'backlog', dateAdded: '2026-06-05', sortOrder: 4 }, // anchor +155
  },
];

/**
 * Build a realistic {@link AppState} covering all four statuses: 3 completed,
 * 1 dropped, 2 playing, and 5 backlog games. IDs are generated fresh on each
 * call; every date is a fixed ISO string anchored to `2026-01-01`.
 */
export function createSeedState(): AppState {
  const games: Game[] = [];
  const userGames: UserGame[] = [];

  for (const entry of SEED) {
    const gameId = generateId();
    games.push({
      id: gameId,
      title: entry.title,
      platforms: entry.platforms,
      releaseDate: entry.releaseDate,
    });
    userGames.push({ id: generateId(), gameId, ...entry.user });
  }

  return { games, userGames };
}

export type UserGameStatus = "backlog" | "playing" | "completed" | "dropped";

export type Game = {
  id: string;           // UUID, generated client-side via crypto.randomUUID()
  igdbId?: number;      // reserved for M7 IGDB integration — do not use yet
  title: string;
  coverImage?: string;  // full URL string
  platforms: string[];  // e.g. ["PC", "PS5"]
  releaseDate?: string; // ISO 8601 date string e.g. "2022-02-25"
};

export type UserGame = {
  id: string;
  gameId: string;           // references Game.id
  status: UserGameStatus;
  dateAdded: string;        // ISO 8601 — set on creation
  dateStarted?: string;     // ISO 8601 — set when status → "playing"
  dateCompleted?: string;   // ISO 8601 — set when status → "completed" or "dropped"
  rating?: number;          // integer 1–10, optional
  platform?: string;        // which platform user is playing on
  sortOrder: number;        // lower = earlier in backlog queue
};

export type AppState = {
  games: Game[];
  userGames: UserGame[];
};

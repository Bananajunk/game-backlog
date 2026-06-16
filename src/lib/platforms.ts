/**
 * Platform options offered as checkboxes by the manual game forms, in display
 * order. The single source of truth shared by `<add-game-form>` (entry) and
 * `<backlog-list>`'s inline edit form, so the two can never drift apart.
 */
export const PLATFORMS = [
  'PC',
  'PS5',
  'PS4',
  'Xbox Series X',
  'Xbox One',
  'Nintendo Switch',
  'Mobile',
  'Other',
] as const;

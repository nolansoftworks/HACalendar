/**
 * The household roster ([ADR-0021], stored per [ADR-0026]).
 *
 * A person is a Home Assistant **label**; their calendar is the entity wearing
 * that label. The reading and writing lives in `ha/roster.ts` -- this file is
 * just the shared vocabulary.
 *
 * `id` is the `label_id`, and it is stable across a rename. That matters: it is
 * what chore completions get logged against ([ADR-0014]), so renaming "Emma"
 * must not orphan her history.
 */

export interface Person {
  /** HA `label_id`. Stable across renames. Logbook-facing. */
  id: string;
  name: string;
  /** Arbitrary hex. HA's label registry accepts it, verified 2026-09-03. */
  color: string;
  choreList?: string;
  calendar?: string;
  /**
   * Where this person's *repeating* chores are stored ([ADR-0030]): a second
   * calendar wearing both their label and the "Chore schedule" one. `todo` has
   * no recurrence, so a repeat is an `RRULE` event here that the nightly
   * automation materializes onto `choreList` ([ADR-0008]).
   *
   * Never rendered in the week or month grid -- a chore rule is not an
   * appointment, and showing "Feed the dog" seven times would bury the day.
   */
  choreCalendar?: string;
}

export interface Roster {
  /** 0 = Sunday. A display preference, kept out of the label registry. */
  weekStartsOn: number;
  people: Person[];
}

/** Shown when nobody is set up yet, so a fresh install explains itself. */
export const ROSTER_SETUP_HINT =
  "No people yet — tap Settings to add everyone in the house.";

/**
 * Used before the roster has loaded, and when a household has nobody set up.
 * A blank grid in the kitchen is worse than an un-colored one, so this still
 * renders the shared calendar.
 */
export const DEFAULT_ROSTER: Roster = { weekStartsOn: 0, people: [] };

/**
 * A readable palette for new people, in offer order.
 *
 * Every entry is dark enough that `readableTextOn()` returns white, so chip
 * text stays uniform across the grid instead of flipping between black and
 * white. Hues are spread so adjacent choices stay distinguishable.
 */
export const PERSON_COLORS = [
  "#a61e4d",
  "#1864ab",
  "#2b8a3e",
  "#e8590c",
  "#6741d9",
  "#c2255c",
  "#0b7285",
  "#5c940d",
  "#d9480f",
  "#862e9c",
  "#1098ad",
  "#495057",
];

/** The next unused color, so two people don't arrive the same shade. */
export function suggestColor(taken: readonly string[]): string {
  const used = taken.map((color) => color.toLowerCase());
  for (const color of PERSON_COLORS) {
    if (used.indexOf(color) === -1) return color;
  }
  return PERSON_COLORS[taken.length % PERSON_COLORS.length]!;
}

/**
 * The household roster ([ADR-0021]).
 *
 * This is app config, not HA state, and it deliberately cannot be derived from
 * entities: parents appear in the "who?" picker ([ADR-0018]) but own no chore
 * list, so there is no `todo.chores_*` to enumerate them from.
 *
 * `id` is stable and is what gets written to `logbook.log` -- never the display
 * name. Renaming "Emma" must not orphan her history.
 */

export interface Person {
  /** Stable, logbook-facing. Never rename this to follow a display name. */
  id: string;
  name: string;
  /** Drives event chips and chore accents. */
  color: string;
  choreList?: string;
  calendar?: string;
}

export interface Roster {
  /** 0 = Sunday. Lives here so the grid isn't re-hardcoded. */
  weekStartsOn: number;
  people: Person[];
}

/** Owner id for events from the shared household calendar. */
export const FAMILY_OWNER_ID = "__family";
export const FAMILY_LABEL = "Family";
export const FAMILY_COLOR = "#0b7285";

/** Shown when no roster is configured, so a fresh install explains itself. */
export const ROSTER_SETUP_HINT =
  "No people configured yet — add config/www/hacalendar-config/people.json to show a calendar per person.";

/**
 * Used when `people.json` is missing or unreadable. It must still produce a
 * working wall calendar: a blank grid in the kitchen is worse than an
 * un-colored one, so the fallback is the shared calendar on its own.
 */
export const DEFAULT_ROSTER: Roster = { weekStartsOn: 0, people: [] };

/**
 * Where the operator's roster lives, and why it is not in this repo.
 *
 * This project is meant to be forked and run against someone else's Home
 * Assistant, so a household's actual members are **their** config, not our
 * source. The roster is therefore read from a directory the build never
 * touches:
 *
 *     config/www/hacalendar-config/people.json   ->  /local/hacalendar-config/people.json
 *
 * That path matters. The bundle is emitted into `config/www/hacalendar/` with
 * Vite's `emptyOutDir`, which deletes everything in that folder on every
 * build -- so a roster kept beside the bundle would be destroyed by the next
 * deploy. Keeping it in a sibling directory means it survives upgrades, is
 * never committed, and differs per household without anyone forking the code.
 *
 * The relative candidates after it exist only so `vite dev` can serve a local
 * `public/people.json` (git-ignored) while working on the UI.
 */
const OPERATOR_ROSTER_URL = "/local/hacalendar-config/people.json";

function candidateUrls(): string[] {
  const urls: string[] = [OPERATOR_ROSTER_URL];
  try {
    urls.push(new URL("people.json", import.meta.url).href);
    urls.push(new URL("../people.json", import.meta.url).href);
  } catch {
    // import.meta.url unavailable (very old bundling path); fall through.
  }
  return urls;
}

/**
 * Fetch and validate the roster. Never rejects -- a malformed or missing file
 * degrades to `DEFAULT_ROSTER` rather than taking the calendar down.
 */
export async function loadRoster(url?: string): Promise<Roster> {
  const candidates = url ? [url] : candidateUrls();

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: "no-cache" });
      if (!response.ok) continue;
      return normalizeRoster(await response.json());
    } catch {
      // Try the next candidate.
    }
  }
  return DEFAULT_ROSTER;
}

/**
 * Coerce untrusted JSON into a `Roster`, dropping entries that cannot work.
 *
 * A person without an `id` cannot be attributed in the logbook and a person
 * without a `calendar` has nothing to overlay, so both are skipped rather than
 * rendered half-broken.
 */
export function normalizeRoster(input: unknown): Roster {
  if (!input || typeof input !== "object") return DEFAULT_ROSTER;
  const raw = input as { weekStartsOn?: unknown; people?: unknown };

  const weekStartsOn =
    typeof raw.weekStartsOn === "number" && Number.isFinite(raw.weekStartsOn)
      ? raw.weekStartsOn
      : 0;

  const people: Person[] = [];
  if (Array.isArray(raw.people)) {
    for (const entry of raw.people) {
      if (!entry || typeof entry !== "object") continue;
      const person = entry as Record<string, unknown>;
      const id = typeof person["id"] === "string" ? person["id"] : "";
      if (!id) continue;

      people.push({
        id,
        name: typeof person["name"] === "string" ? person["name"] : id,
        color:
          typeof person["color"] === "string" ? person["color"] : FAMILY_COLOR,
        ...(typeof person["choreList"] === "string"
          ? { choreList: person["choreList"] }
          : {}),
        ...(typeof person["calendar"] === "string"
          ? { calendar: person["calendar"] }
          : {}),
      });
    }
  }

  return { weekStartsOn, people };
}

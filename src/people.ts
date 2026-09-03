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

/**
 * Used when `people.json` is missing or unreadable. It must still produce a
 * working wall calendar: a blank grid in the kitchen is worse than an
 * un-colored one, so the fallback is the shared calendar on its own.
 */
export const DEFAULT_ROSTER: Roster = { weekStartsOn: 0, people: [] };

/**
 * Where to look for `people.json`, in order.
 *
 * The file ships in `public/`, so Vite copies it beside the bundle and HA
 * serves it from `/local/hacalendar/people.json`. Resolving relative to
 * `import.meta.url` covers that for both mount points, but this module may be
 * bundled into `chunks/`, so the parent directory is tried too. The absolute
 * path is the backstop for when HA serves us and both relative guesses miss.
 */
function candidateUrls(): string[] {
  const urls: string[] = [];
  try {
    urls.push(new URL("people.json", import.meta.url).href);
    urls.push(new URL("../people.json", import.meta.url).href);
  } catch {
    // import.meta.url unavailable (very old bundling path); fall through.
  }
  urls.push("/local/hacalendar/people.json");
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

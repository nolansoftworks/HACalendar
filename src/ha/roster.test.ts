import { test } from "node:test";
import assert from "node:assert/strict";
import type { HaClient, HaMessage } from "./client.js";
import { fetchRoster, fetchUnassignedCalendars } from "./roster.js";

/**
 * A stub HaClient that answers registry queries from fixtures. Lets the
 * roster-derivation rules be tested without a Home Assistant.
 */
function stubClient(
  labels: unknown[],
  entities: unknown[],
  configEntries: unknown[] = [],
): HaClient {
  return {
    callWS: async <T,>(msg: HaMessage): Promise<T> => {
      if (msg.type === "config/label_registry/list") return labels as T;
      if (msg.type === "config/entity_registry/list") return entities as T;
      if (msg.type === "config_entries/get") return configEntries as T;
      throw new Error(`unexpected ws call: ${msg.type}`);
    },
    subscribeMessage: async () => async () => undefined,
    callService: async () => undefined,
    callApi: async () => undefined as never,
  };
}

const label = (id: string, name: string, color: string | null = "#123456") => ({
  label_id: id, name, color, icon: null, description: null,
});
const entity = (entity_id: string, labels: string[] = []) => ({ entity_id, labels });

test("a person is a label attached to a calendar", async () => {
  const client = stubClient(
    [label("alex", "Alex", "#a61e4d")],
    [entity("calendar.alex", ["alex"])],
  );
  const roster = await fetchRoster(client);
  assert.equal(roster.people.length, 1);
  assert.deepEqual(roster.people[0], {
    id: "alex", name: "Alex", color: "#a61e4d", calendar: "calendar.alex",
  });
});

test("a label with no calendar is not a person", async () => {
  // Households use HA labels for their own purposes. This app must not claim
  // every label it finds, only the ones wearing a calendar.
  const client = stubClient(
    [label("alex", "Alex"), label("holiday", "Holiday"), label("upstairs", "Upstairs")],
    [entity("calendar.alex", ["alex"]), entity("light.lamp", ["upstairs"])],
  );
  const roster = await fetchRoster(client);
  assert.deepEqual(roster.people.map((p) => p.id), ["alex"]);
});

test("a label on a non-calendar entity is ignored", async () => {
  const client = stubClient(
    [label("alex", "Alex")],
    [entity("light.alex_lamp", ["alex"]), entity("sensor.alex", ["alex"])],
  );
  assert.equal((await fetchRoster(client)).people.length, 0);
});

test("a label on two calendars resolves deterministically", async () => {
  const client = stubClient(
    [label("alex", "Alex")],
    [entity("calendar.first", ["alex"]), entity("calendar.second", ["alex"])],
  );
  const roster = await fetchRoster(client);
  assert.equal(roster.people.length, 1);
  assert.equal(roster.people[0]?.calendar, "calendar.first", "first entity wins");
});

test("a colourless label still renders", async () => {
  const client = stubClient(
    [label("alex", "Alex", null)],
    [entity("calendar.alex", ["alex"])],
  );
  const roster = await fetchRoster(client);
  assert.equal(roster.people[0]?.color, "#0b7285", "falls back rather than breaking");
});

test("people come back in a stable, human order", async () => {
  const client = stubClient(
    [label("c", "Zoe"), label("a", "Alex"), label("b", "Mia")],
    [entity("calendar.c", ["c"]), entity("calendar.a", ["a"]), entity("calendar.b", ["b"])],
  );
  const roster = await fetchRoster(client);
  assert.deepEqual(roster.people.map((p) => p.name), ["Alex", "Mia", "Zoe"]);
});

test("weekStartsOn passes through", async () => {
  const client = stubClient([], []);
  assert.equal((await fetchRoster(client)).weekStartsOn, 0);
  assert.equal((await fetchRoster(client, 1)).weekStartsOn, 1);
});

test("an empty house yields an empty roster, not an error", async () => {
  const roster = await fetchRoster(stubClient([], []));
  assert.deepEqual(roster.people, []);
});

test("unassigned calendars are offered, assigned ones are not", async () => {
  const client = stubClient(
    [label("alex", "Alex")],
    [
      { ...entity("calendar.alex", ["alex"]), config_entry_id: "e1" },
      { ...entity("calendar.family", []), config_entry_id: "e2" },
      { ...entity("light.lamp", []), config_entry_id: "e3" },
    ],
    [{ entry_id: "e2", domain: "local_calendar", title: "Family" }],
  );
  const free = await fetchUnassignedCalendars(client);
  assert.deepEqual(free.map((c) => c.entityId), ["calendar.family"]);
  assert.equal(free[0]?.name, "Family", "named from its config entry");
});

test("adoption list survives HA refusing the config-entry query", async () => {
  const client: HaClient = {
    callWS: async <T,>(msg: HaMessage): Promise<T> => {
      if (msg.type === "config/entity_registry/list") {
        return [{ ...entity("calendar.spare", []), config_entry_id: "e9" }] as T;
      }
      if (msg.type === "config_entries/get") throw new Error("unauthorized");
      return [] as T;
    },
    subscribeMessage: async () => async () => undefined,
    callService: async () => undefined,
    callApi: async () => undefined as never,
  };
  const free = await fetchUnassignedCalendars(client);
  assert.deepEqual(free.map((c) => c.entityId), ["calendar.spare"]);
  assert.equal(free[0]?.name, "calendar.spare", "falls back to the entity id");
});

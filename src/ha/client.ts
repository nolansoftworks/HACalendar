import type { Connection } from "home-assistant-js-websocket";

/** Every HA websocket message is discriminated by `type`. */
export interface HaMessage extends Record<string, unknown> {
  type: string;
}

/**
 * The narrow slice of Home Assistant this app actually needs.
 *
 * This interface is the whole reason the same bundle can run both as an HA
 * panel and as a standalone page. UI code depends on `HaClient` and nothing
 * else -- never on the `hass` object, never on a raw Connection. Two adapters
 * below satisfy it. Keep it that way.
 */
export interface HaClient {
  callWS<T>(msg: HaMessage): Promise<T>;
  subscribeMessage<T>(
    callback: (message: T) => void,
    msg: HaMessage,
  ): Promise<() => Promise<void>>;
  callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
  ): Promise<unknown>;
  /**
   * REST call against `/api/<path>`.
   *
   * Almost everything here speaks websocket. This exists for the one thing
   * that has no websocket equivalent: config entry flows, which is how a
   * `local_calendar` gets created ([ADR-0026]). Prefer `callWS`.
   */
  callApi<T>(method: string, path: string, body?: unknown): Promise<T>;
}

/** Shape of the `hass` object HA sets on a custom panel element. */
export interface HassLike {
  connection: Connection;
  callWS<T>(msg: HaMessage): Promise<T>;
  callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
  ): Promise<unknown>;
  callApi<T>(method: string, path: string, parameters?: unknown): Promise<T>;
}

// HA replaces the `hass` object on every state change. Building a fresh
// adapter each render would hand the UI a new `client` identity every time,
// which would tear down and rebuild every websocket subscription. Cache on
// the connection, which is stable for the life of the page.
const adapterCache = new WeakMap<Connection, HaClient>();

/** Adapter for mount point 1: running as a custom panel inside HA's frontend. */
export function clientFromHass(hass: HassLike): HaClient {
  const cached = adapterCache.get(hass.connection);
  if (cached) return cached;

  const connection = hass.connection;
  const client: HaClient = {
    callWS: (msg) => connection.sendMessagePromise(msg),
    subscribeMessage: (callback, msg) =>
      connection.subscribeMessage(callback, msg),
    callService: (domain, service, data) =>
      hass.callService(domain, service, data),
    callApi: (method, path, body) => hass.callApi(method, path, body),
  };

  adapterCache.set(connection, client);
  return client;
}

/** The bits of `Auth` we need to make a REST call from the standalone page. */
interface AuthLike {
  accessToken?: string;
  data?: { hassUrl?: string; access_token?: string };
}

/** Adapter for mount point 2: standalone page, own websocket connection. */
export function clientFromConnection(connection: Connection): HaClient {
  const cached = adapterCache.get(connection);
  if (cached) return cached;

  const client: HaClient = {
    callWS: (msg) => connection.sendMessagePromise(msg),
    subscribeMessage: (callback, msg) =>
      connection.subscribeMessage(callback, msg),
    callService: (domain, service, data) =>
      connection.sendMessagePromise({
        type: "call_service",
        domain,
        service,
        service_data: data ?? {},
      }),
    // No `hass` here, so the REST call is assembled by hand from the auth the
    // websocket connection is already using.
    callApi: async (method, path, body) => {
      const auth = (connection.options as { auth?: AuthLike }).auth;
      const token = auth?.accessToken ?? auth?.data?.access_token;
      const baseUrl = auth?.data?.hassUrl ?? "";
      if (!token) throw new Error("Not signed in to Home Assistant.");

      const response = await fetch(`${baseUrl}/api/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      return response.status === 204 ? undefined : await response.json();
    },
  };

  adapterCache.set(connection, client);
  return client;
}

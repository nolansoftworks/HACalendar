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
  };

  adapterCache.set(connection, client);
  return client;
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
  };

  adapterCache.set(connection, client);
  return client;
}

import {
  createConnection,
  createLongLivedTokenAuth,
  type Connection,
} from "home-assistant-js-websocket";
import { clientFromConnection } from "./ha/client.js";
import "./ui/month-view.js";

/**
 * Mount point 2: standalone page, no HA frontend.
 *
 * Auth tradeoff, stated plainly: this stores a long-lived access token in
 * localStorage. That token is full HA API access, and anyone holding the
 * tablet holds the token. Acceptable for LAN-only family devices; not
 * acceptable for anything reachable from the internet. Do not expose this
 * page through a reverse proxy without putting real auth in front of it.
 */

const STORAGE_URL = "hacal.url";
const STORAGE_TOKEN = "hacal.token";

function readSetting(key: string, param: string, fallback = ""): string {
  const fromQuery = new URLSearchParams(location.search).get(param);
  if (fromQuery) {
    localStorage.setItem(key, fromQuery);
    return fromQuery;
  }
  return localStorage.getItem(key) ?? fallback;
}

async function connect(hassUrl: string, token: string): Promise<Connection> {
  const auth = createLongLivedTokenAuth(hassUrl, token);
  return createConnection({ auth });
}

function renderSetup(root: HTMLElement, message?: string): void {
  root.innerHTML = `
    <form style="display:grid;gap:12px;max-width:28rem;margin:15vh auto;padding:0 1rem;font-family:system-ui,sans-serif">
      <h1 style="margin:0;font-size:1.4rem">Connect to Home Assistant</h1>
      ${message ? `<p style="color:#8c1d18;margin:0">${message}</p>` : ""}
      <label>Server URL
        <input name="url" type="url" required placeholder="http://homeassistant.local:8123"
               value="${localStorage.getItem(STORAGE_URL) ?? ""}"
               style="width:100%;min-height:44px;font-size:1rem" />
      </label>
      <label>Long-lived access token
        <input name="token" type="password" required
               style="width:100%;min-height:44px;font-size:1rem" />
      </label>
      <button type="submit" style="min-height:44px;font-size:1rem">Connect</button>
      <small style="opacity:.7">Create a token in HA under your profile → Security → Long-lived access tokens.</small>
    </form>
  `;

  const form = root.querySelector("form");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    localStorage.setItem(STORAGE_URL, String(data.get("url")).replace(/\/$/, ""));
    localStorage.setItem(STORAGE_TOKEN, String(data.get("token")));
    location.reload();
  });
}

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) throw new Error("missing #app");

  // Served from HA itself (/local/hacalendar/), so same-origin is the sane
  // default. In `vite dev` the origin is :5173, so pass ?ha= once.
  const hassUrl = readSetting(STORAGE_URL, "ha", location.origin);
  const token = readSetting(STORAGE_TOKEN, "token");
  const entityId = readSetting("hacal.entity", "entity", "calendar.family");

  if (!token) {
    renderSetup(root);
    return;
  }

  let connection: Connection;
  try {
    connection = await connect(hassUrl, token);
  } catch {
    localStorage.removeItem(STORAGE_TOKEN);
    renderSetup(root, `Could not connect to ${hassUrl}. Check the URL and token.`);
    return;
  }

  const view = document.createElement("hacal-month-view");
  view.client = clientFromConnection(connection);
  view.entityId = entityId;
  root.replaceChildren(view);
}

void main();

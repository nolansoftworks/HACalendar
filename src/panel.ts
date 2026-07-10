import { LitElement, html, css } from "lit";
import { clientFromHass, type HassLike } from "./ha/client.js";
import "./ui/month-view.js";

interface PanelConfig {
  config?: { entity_id?: string } | null;
}

/**
 * Mount point 1: custom panel inside the HA frontend.
 *
 * HA sets `hass`, `narrow`, `route` and `panel` as properties on this element.
 * The element tag must match the `name:` in the panel_custom config.
 *
 * This file's only job is adapting HA's world to `HaClient` and handing it to
 * shared UI. Keep app logic out of here -- whatever lands in this file has to
 * be written a second time in standalone.ts.
 */
export class HaCalendarPanel extends LitElement {
  static override properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    panel: { attribute: false },
  };

  hass?: HassLike;
  narrow = false;
  panel?: PanelConfig;

  override render() {
    if (!this.hass) return html`<p>Connecting…</p>`;

    return html`
      <hacal-month-view
        .client=${clientFromHass(this.hass)}
        .entityId=${this.panel?.config?.entity_id ?? "calendar.family"}
      ></hacal-month-view>
    `;
  }

  static override styles = css`
    :host {
      display: block;
      height: 100vh;
    }
  `;
}

customElements.define("hacalendar-panel", HaCalendarPanel);

import { ACCOUNT_SERVER } from "../core/account-server.mjs";
import { boundedJson } from "../core/announcements.mjs";

/** Owner credential stays in Admin main memory, separate from the GitHub token. */
export class AdminMetrics {
  constructor({ server = ACCOUNT_SERVER, request = boundedJson } = {}) {
    this.server = server.replace(/\/$/, "");
    this.request = request;
    this.key = "";
    this.epoch = 0;
  }
  connect(key) {
    if (!/^[a-f0-9]{64}$/.test(key || "")) throw Error("Invalid metrics key");
    this.epoch++;
    this.key = key;
    return { connected: true };
  }
  disconnect() {
    this.epoch++;
    this.key = "";
    return { connected: false };
  }
  async read() {
    if (!this.key) throw Error("Connect metrics first");
    const epoch = this.epoch;
    const body = await this.request(
      `${this.server}/v1/admin/usage`,
      { headers: { Authorization: `Bearer ${this.key}` }, redirect: "error" },
      64 * 1024,
    );
    if (epoch !== this.epoch) throw Error("Connection cancelled");
    if (
      ![body.at, body.online, body.day, body.month].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      body.windowMinutes !== 10 ||
      !Array.isArray(body.versions)
    )
      throw Error("Invalid metrics response");
    return {
      at: body.at,
      online: body.online,
      day: body.day,
      month: body.month,
      versions: body.versions
        .slice(0, 100)
        .filter(
          (x) =>
            ["desktop", "web"].includes(x.platform) &&
            /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[a-zA-Z0-9.-]{1,30})?$/.test(
              x.version,
            ) &&
            Number.isSafeInteger(x.devices) &&
            x.devices >= 0,
        )
        .map((x) => ({
          platform: x.platform,
          version: x.version,
          devices: x.devices,
        })),
    };
  }
}

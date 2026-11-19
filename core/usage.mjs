import { ACCOUNT_SERVER } from "./account-server.mjs";

const TOKEN = /^[a-f0-9]{64}$/;
export const USAGE_INTERVAL = 2 * 60000;
/** Device-local, opt-in counts only. Never accepts a title, account or source URL. */
export class UsagePulse {
  constructor(
    client,
    {
      server = ACCOUNT_SERVER,
      request = fetch,
      platform = "desktop",
      now = Date.now,
    } = {},
  ) {
    this.client = client;
    this.server = server.replace(/\/$/, "");
    this.request = request;
    this.platform = platform;
    this.now = now;
    this.epoch = 0;
    this.pending = null;
    this.last = 0;
    this.active = () => true;
    const old = client.state.usageMetrics;
    client.state.usageMetrics =
      old?.enabled === true && TOKEN.test(old.token)
        ? { enabled: true, token: old.token }
        : { enabled: false };
  }
  publicState() {
    return { enabled: this.client.state.usageMetrics?.enabled === true };
  }
  start(active = () => true) {
    this.stop();
    this.active = active;
    this.tick();
    this.timer = setInterval(() => this.tick(), USAGE_INTERVAL);
    this.timer.unref?.();
  }
  stop() {
    clearInterval(this.timer);
    this.epoch++;
    this.pending?.abort();
  }
  async edit(enabled) {
    if (typeof enabled !== "boolean") throw Error("Invalid usage preference");
    if (enabled === this.publicState().enabled) return this.publicState();
    const old = this.client.state.usageMetrics || { enabled: false };
    this.epoch++;
    this.pending?.abort();
    const token = enabled
      ? [...crypto.getRandomValues(new Uint8Array(32))]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      : "";
    // A commit (sixth pass, V2): the pulse or the deletion request is sent
    // only once the choice is durable; refused, the old choice stands.
    const written = this.client.transact(() => {
      const next = enabled ? { enabled, token } : { enabled: false };
      this.client.state.usageMetrics = next;
      return () => {
        if (this.client.state.usageMetrics === next)
          this.client.state.usageMetrics = old;
      };
    });
    // Seventh pass, W2: the timer's tick sends nothing while it is written.
    if (enabled) this.client.holdOptIn?.("usage", written);
    await written;
    this.last = 0;
    if (enabled) await this.tick();
    else if (old.token && this.server) {
      // Opt-out sends only a deletion request. A server tombstone rejects a late pulse.
      await this.request(`${this.server}/v1/usage`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: old.token }),
        credentials: "omit",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      }).catch(() => {});
    }
    return this.publicState();
  }
  async tick() {
    if (
      !this.publicState().enabled ||
      this.client.optInPending?.("usage") ||
      !this.server ||
      !this.active() ||
      this.pending ||
      (this.last && this.now() - this.last < USAGE_INTERVAL)
    )
      return;
    const epoch = this.epoch,
      token = this.client.state.usageMetrics.token;
    const abort = new AbortController();
    this.pending = abort;
    const timer = setTimeout(() => abort.abort(), 8000);
    timer.unref?.();
    this.last = this.now();
    try {
      await this.request(`${this.server}/v1/usage`, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        signal: abort.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          platform: this.platform,
          version: this.client.version,
        }),
      });
    } catch {
      /* Metrics must never affect viewing or produce URL/identity logs. */
    } finally {
      clearTimeout(timer);
      if (this.pending === abort) this.pending = null;
      if (epoch !== this.epoch) this.last = 0;
    }
  }
}

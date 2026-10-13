import { randomBytes } from "node:crypto";
import {
  ANNOUNCEMENT_REPO,
  ANNOUNCEMENT_PATH,
  cleanFeed,
  cleanAnnouncement,
  boundedJson,
  FEED_LIMIT,
} from "../core/announcements.mjs";

const API = "https://api.github.com";
export const RELEASES_LIMIT = 2 * 1024 * 1024;
const CONTENT = `/repos/${ANNOUNCEMENT_REPO}/contents/${ANNOUNCEMENT_PATH}`;
/** This module is used only by the separate admin main process. */
export class AdminGithub {
  constructor({ request = boundedJson, now = Date.now } = {}) {
    this.request = request;
    this.now = now;
    this.token = "";
    this.previewed = null;
    this.epoch = 0;
    this.busy = false;
  }
  async api(path, options = {}, token = this.token, limit = 256 * 1024) {
    return this.request(
      `${API}${path}`,
      {
        ...options,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
      },
      limit,
    );
  }
  async connect(value) {
    if (this.busy) throw new Error("Publishing in progress");
    const token = typeof value === "string" ? value.trim() : "";
    if (!/^[A-Za-z0-9_]{30,255}$/.test(token))
      throw new Error("Invalid GitHub token");
    const epoch = ++this.epoch;
    this.token = "";
    this.previewed = null;
    const user = await this.api("/user", {}, token);
    const repo = await this.api(`/repos/${ANNOUNCEMENT_REPO}`, {}, token);
    if (epoch !== this.epoch) throw new Error("Connection cancelled");
    if (
      String(user.login).toLowerCase() !== "abadiosa" ||
      repo.private !== false ||
      repo.default_branch !== "main" ||
      !repo.permissions?.push
    )
      throw new Error("Owner access to the public repository is required");
    this.token = token;
    return { connected: true, login: user.login };
  }
  disconnect() {
    if (this.busy) throw new Error("Publishing in progress");
    this.epoch++;
    this.token = "";
    this.previewed = null;
    return { connected: false };
  }
  async feed() {
    const data = await this.api(`${CONTENT}?ref=main`);
    if (
      data.encoding !== "base64" ||
      data.size > 65536 ||
      !/^[a-f0-9]{40}$/.test(data.sha)
    )
      throw new Error("Invalid feed file");
    return {
      sha: data.sha,
      feed: cleanFeed(
        JSON.parse(Buffer.from(data.content, "base64").toString("utf8")),
      ),
    };
  }
  async preview(draft) {
    if (!this.token || this.busy)
      throw new Error("Connect the owner account first");
    const epoch = this.epoch;
    const item = cleanAnnouncement({
      ...draft,
      id: randomBytes(16).toString("hex"),
      at: this.now(),
    });
    const { sha, feed } = await this.feed();
    if (epoch !== this.epoch) throw new Error("Connection cancelled");
    const next = {
      schema: 1,
      items: [
        item,
        ...feed.items.filter((n) => n.expires > this.now()).slice(0, 79),
      ],
    };
    while (Buffer.byteLength(JSON.stringify(next)) + 1 > FEED_LIMIT)
      next.items.pop();
    cleanFeed(next);
    const nonce = randomBytes(24).toString("hex");
    this.previewed = { nonce, item, sha, feed: next, at: this.now(), epoch };
    return { nonce, item, count: next.items.length };
  }
  async publish(nonce) {
    const preview = this.previewed;
    if (
      !this.token ||
      this.busy ||
      !preview ||
      preview.nonce !== nonce ||
      preview.epoch !== this.epoch ||
      this.now() - preview.at > 10 * 60000 ||
      preview.item.expires <= this.now()
    )
      throw new Error("Preview again before publishing");
    this.busy = true;
    this.previewed = null;
    try {
      // The reviewed blob SHA is the write lease: never overwrite another admin's change.
      const result = await this.api(CONTENT, {
        method: "PUT",
        body: JSON.stringify({
          message: `Publish Riwaq announcement ${preview.item.id}`,
          branch: "main",
          sha: preview.sha,
          content: Buffer.from(JSON.stringify(preview.feed) + "\n").toString(
            "base64",
          ),
        }),
      });
      return {
        published: true,
        id: preview.item.id,
        commit: result.commit?.sha,
      };
    } finally {
      this.busy = false;
    }
  }
  async releases() {
    // Each release carries its full notes (about 23 KB now, growing with
    // every release): ten of them passed 200 KB at 0.43.1 and would outgrow
    // the general 256 KB cap within a few releases.
    const releases = await this.api(
      `/repos/${ANNOUNCEMENT_REPO}/releases?per_page=10`,
      {},
      "",
      RELEASES_LIMIT,
    );
    return releases
      .filter((r) => !r.draft)
      .map((r) => ({
        tag: r.tag_name,
        name: r.name,
        at: r.published_at,
        prerelease: !!r.prerelease,
      }));
  }
}

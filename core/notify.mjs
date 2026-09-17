/**
 * Outgoing notifications.
 *
 * Riwaq sends nothing anywhere by default. A viewer who wants a Discord or
 * Telegram ping supplies their own webhook or bot, each target is checked
 * against its own official host, and redirects are refused so a mistyped URL
 * cannot forward the message somewhere else.
 */

export const NOTIFY_TARGETS = [
  {
    id: "discord",
    name: "Discord",
    description: "إشعار عبر Webhook في قناتك",
    url: "https://support.discord.com/hc/articles/228383668",
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "إشعار عبر بوت خاص بك",
    url: "https://core.telegram.org/bots#how-do-i-create-a-bot",
  },
];
const DISCORD_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discord.com",
]);
const KIND_LABELS = {
  finished: "أنهى المشاهدة",
  started: "بدأ المشاهدة",
  added: "أضاف إلى المكتبة",
  syncFailed: "تعذّرت المزامنة",
};

function line(event) {
  const label = KIND_LABELS[event.kind] || "تحديث";
  const title = event.title || "عنوان";
  const episode = event.episode ? ` — ${event.episode}` : "";
  return `${label}: ${title}${episode}`;
}

export function discordPayload(event) {
  return {
    username: "رِواق",
    embeds: [
      {
        title: line(event),
        description: event.description
          ? String(event.description).slice(0, 400)
          : undefined,
        color: 0xd8a24a,
        timestamp: new Date(event.at ?? Date.now()).toISOString(),
        ...(event.poster && /^https:\/\//i.test(event.poster)
          ? { thumbnail: { url: event.poster } }
          : {}),
      },
    ],
  };
}

export function telegramPayload(event, chatId) {
  const episode = event.episode ? ` — ${event.episode}` : "";
  return {
    chat_id: chatId,
    text: `*${KIND_LABELS[event.kind] || "تحديث"}*\n${event.title || "عنوان"}${episode}`,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  };
}

export class Notifier {
  constructor(client) {
    this.client = client;
  }
  get store() {
    const state = this.client.state;
    state.notify ||= {};
    return state.notify;
  }
  publicState() {
    return NOTIFY_TARGETS.map((target) => {
      const entry = this.store[target.id] || {};
      return {
        ...target,
        configured:
          target.id === "discord"
            ? !!entry.webhook
            : !!(entry.token && entry.chatId),
        enabled: entry.enabled !== false,
        status: entry.status || "untested",
        testedAt: entry.testedAt || null,
      };
    });
  }
  save({ id, webhook, token, chatId, enabled, clear = false }) {
    if (!NOTIFY_TARGETS.some((target) => target.id === id))
      throw new Error("وجهة الإشعارات غير معروفة");
    if (clear) {
      delete this.store[id];
      this.client.persist();
      return this.client.publicState();
    }
    const entry = (this.store[id] ||= {});
    if (id === "discord" && webhook !== undefined) {
      const url = new URL(String(webhook));
      if (
        url.protocol !== "https:" ||
        !DISCORD_HOSTS.has(url.host) ||
        !url.pathname.startsWith("/api/webhooks/")
      )
        throw new Error("أدخل رابط Webhook رسمياً من Discord");
      entry.webhook = url.toString();
      entry.status = "untested";
    }
    if (id === "telegram") {
      if (token !== undefined) {
        if (!/^\d{5,}:[\w-]{20,}$/.test(String(token)))
          throw new Error("رمز البوت غير صالح");
        entry.token = String(token);
        entry.status = "untested";
      }
      if (chatId !== undefined) {
        if (
          !/^-?\d{1,20}$/.test(String(chatId)) &&
          !/^@[\w]{3,64}$/.test(String(chatId))
        )
          throw new Error("معرّف المحادثة غير صالح");
        entry.chatId = String(chatId);
        entry.status = "untested";
      }
    }
    if (typeof enabled === "boolean") entry.enabled = enabled;
    this.client.persist();
    return this.client.publicState();
  }
  async deliver(id, event) {
    const entry = this.store[id];
    if (!entry || entry.enabled === false) return false;
    if (id === "discord") {
      if (!entry.webhook) return false;
      await this.client.request(entry.webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(discordPayload(event)),
        redirect: "error",
      });
      return true;
    }
    if (!entry.token || !entry.chatId) return false;
    await this.client.request(
      `https://api.telegram.org/bot${encodeURIComponent(entry.token)}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(telegramPayload(event, entry.chatId)),
        redirect: "error",
      },
    );
    return true;
  }
  async test(id) {
    const entry = this.store[id];
    if (!entry) throw new Error("احفظ بيانات الوجهة أولاً");
    try {
      await this.deliver(id, {
        kind: "started",
        title: "اختبار رِواق",
        at: Date.now(),
      });
      entry.status = "ok";
    } catch {
      entry.status = "error";
    }
    entry.testedAt = Date.now();
    this.client.persist();
    return this.client.publicState();
  }
  /** Fire and forget: a failed webhook must never interrupt playback. */
  async notify(event) {
    if (
      !this.client.state.settings?.notifyOnFinish &&
      event.kind === "finished"
    )
      return;
    await Promise.allSettled(
      NOTIFY_TARGETS.map((target) => this.deliver(target.id, event)),
    );
  }
}

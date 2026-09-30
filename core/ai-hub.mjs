import {
  AI_PROVIDERS,
  aiModel,
  aiRequest,
  cleanAiStore,
  parseAiTitles,
} from "./ai-search.mjs";
import { withoutAdult } from "./adult.mjs";

const plain = (value) =>
  String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const yearOf = (meta) =>
  Number(String(meta?.releaseInfo || meta?.year || "").slice(0, 4)) || null;

/** The best match for a suggested title among search results. */
export function bestMatch(metas, { title, year, type }) {
  const wanted = plain(title);
  const pool = (metas || []).filter(
    (m) => m?.id && m.name && (!type || m.type === type),
  );
  const same = pool.filter((m) => plain(m.name) === wanted);
  return (
    same.find((m) => !year || Math.abs((yearOf(m) || year) - year) <= 1) ||
    same[0] ||
    pool.find(
      (m) => year && yearOf(m) === year && plain(m.name).includes(wanted),
    ) ||
    null
  );
}

/**
 * AI search with the viewer's own key. The key stays in the client's
 * encrypted state; the interface only learns whether one is saved.
 */
export class AiSearch {
  constructor(client) {
    this.client = client;
  }
  get store() {
    return cleanAiStore(this.client.state.aiSearch);
  }
  publicState() {
    const s = this.store;
    return {
      providers: AI_PROVIDERS.map(({ id, name, model }) => ({
        id,
        name,
        model,
      })),
      provider: s?.provider || "",
      model: s?.model || "",
      configured: !!s,
      status: s?.status || "off",
    };
  }
  save({ provider, key, model, clear = false }) {
    if (clear) delete this.client.state.aiSearch;
    else {
      const current = this.store;
      const nextKey =
        typeof key === "string" && key.trim()
          ? key.trim()
          : current?.provider === provider
            ? current.key
            : "";
      if (!nextKey || /\s/.test(nextKey) || nextKey.length > 512)
        throw new Error("المفتاح غير صالح");
      const next = cleanAiStore({
        provider,
        key: nextKey,
        model: aiModel(provider, model),
      });
      if (!next) throw new Error("مزوّد غير معروف");
      this.client.state.aiSearch = next;
    }
    this.client.persist();
    return this.client.publicState();
  }
  async ask(query) {
    const s = this.store;
    if (!s) throw new Error("أضف مفتاح Groq أو OpenRouter من الإعدادات أولاً");
    const { url, init } = aiRequest({ ...s, query });
    try {
      const body = await this.client.request(url, init);
      this.client.state.aiSearch.status = "ok";
      return parseAiTitles(body);
    } catch (error) {
      const rejected = /HTTP (401|403)/.test(error.message);
      this.client.state.aiSearch.status = rejected ? "rejected" : "error";
      if (rejected) throw new Error("رفض المزوّد المفتاح");
      if (/HTTP 429/.test(error.message))
        throw new Error("بلغت حد الطلبات لدى المزوّد، حاول بعد دقيقة");
      throw new Error("تعذّر الوصول لمزوّد الذكاء الاصطناعي");
    } finally {
      this.client.persist();
    }
  }
  async test() {
    await this.ask("a warm family comedy").catch(() => {});
    return this.client.publicState();
  }
  tmdbReady() {
    const entry = this.client.state.providers?.tmdb;
    return !!entry?.key && entry.enabled !== false;
  }
  async viaTmdb({ title, year, type }) {
    const kind = type === "series" ? "tv" : "movie";
    const params = { query: title, include_adult: "false" };
    if (year)
      params[kind === "tv" ? "first_air_date_year" : "primary_release_year"] =
        year;
    const found = await this.client.tmdbCall(`search/${kind}`, params);
    const hit = found?.results?.[0];
    if (!hit?.id) return null;
    const cache = (this.client.tmdbImdb ||= new Map());
    const key = `${kind}:${hit.id}`;
    if (!cache.has(key)) {
      const ids = await this.client.tmdbCall(`${kind}/${hit.id}/external_ids`);
      cache.set(
        key,
        /^tt\d{5,12}$/.test(ids?.imdb_id || "") ? ids.imdb_id : "",
      );
    }
    const imdb = cache.get(key);
    if (!imdb) return null;
    const released = hit.release_date || hit.first_air_date || "";
    return {
      id: imdb,
      type,
      name: hit.title || hit.name || title,
      poster: /^\/[\w.-]+$/.test(hit.poster_path || "")
        ? `https://image.tmdb.org/t/p/w342${hit.poster_path}`
        : `https://images.metahub.space/poster/medium/${imdb}/img`,
      ...(released ? { releaseInfo: released.slice(0, 4) } : {}),
      ...(hit.adult ? { adult: true } : {}),
    };
  }
  async viaAddons(item) {
    const { rows } = await this.client.catalog({
      search: item.title,
      type: item.type,
    });
    return bestMatch(
      rows.flatMap((r) => r.metas),
      item,
    );
  }
  /** Suggestions for a sentence, found as titles Riwaq can open. */
  async search({ query }) {
    const suggestions = await this.ask(query);
    const useTmdb = this.tmdbReady();
    const found = new Array(suggestions.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < suggestions.length) {
        const index = next++;
        const item = suggestions[index];
        try {
          found[index] =
            (useTmdb ? await this.viaTmdb(item).catch(() => null) : null) ||
            (await this.viaAddons(item));
        } catch {
          found[index] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));
    const seen = new Set();
    let metas = found.filter((m) => {
      if (!m || seen.has(`${m.type}:${m.id}`)) return false;
      seen.add(`${m.type}:${m.id}`);
      return true;
    });
    if (this.client.profiles?.active?.()?.hideAdult)
      metas = withoutAdult(metas);
    return {
      metas,
      suggested: suggestions.length,
      unmatched: suggestions
        .filter((_, i) => !found[i])
        .map((s) => s.title)
        .slice(0, 12),
      via: useTmdb ? "tmdb" : "addons",
    };
  }
}

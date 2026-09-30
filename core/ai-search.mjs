/**
 * AI search (Harbor's AI search page): describe what you feel like watching
 * in your own words, and a language model the viewer chooses suggests titles,
 * which Riwaq then finds through TMDB or the viewer's own addons.
 *
 * The viewer brings their own key for Groq or OpenRouter; it is kept
 * encrypted in main and never reaches the interface. Only the sentence the
 * viewer typed is sent, never their history or library. Pure builders and
 * parsers; the hub does the fetching.
 */

export const AI_PROVIDERS = [
  {
    id: "groq",
    name: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    keys: "https://console.groq.com/keys",
    model: "llama-3.3-70b-versatile",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    keys: "https://openrouter.ai/settings/keys",
    model: "meta-llama/llama-3.3-70b-instruct:free",
  },
];
export const AI_LIMIT = 12;
const MODEL = /^[\w.:/@-]{1,100}$/;

/** A model name the viewer typed, or the provider's default. */
export function aiModel(provider, model) {
  const p = AI_PROVIDERS.find((x) => x.id === provider);
  if (!p) throw new Error("مزوّد غير معروف");
  const wanted = String(model || "").trim();
  return MODEL.test(wanted) ? wanted : p.model;
}

/** The viewer's sentence as one bounded line. */
export function aiQuery(text) {
  const line = String(text || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  if (line.length < 3) throw new Error("اكتب وصفاً أطول قليلاً");
  return line;
}

const SYSTEM = `You recommend films and TV series. The viewer describes what they want, possibly in Arabic.
Reply with JSON only, in this exact shape:
{"titles":[{"title":"Original title as listed on IMDb","year":1999,"type":"movie"}]}
"type" is "movie" or "series". Give at most ${AI_LIMIT} real, existing titles, best match first. No commentary.`;

/** The chat request, in the OpenAI-compatible shape both providers accept. */
export function aiRequest({ provider, key, model, query }) {
  const p = AI_PROVIDERS.find((x) => x.id === provider);
  if (!p) throw new Error("مزوّد غير معروف");
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (p.id === "openrouter") headers["X-Title"] = "Riwaq";
  return {
    url: p.url,
    init: {
      method: "POST",
      headers,
      redirect: "error",
      timeout: 30000,
      body: JSON.stringify({
        model: aiModel(provider, model),
        temperature: 0.4,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: aiQuery(query) },
        ],
      }),
    },
  };
}

/** The titles a reply suggests, validated; a reply that is not JSON is empty. */
export function parseAiTitles(body) {
  let text = body?.choices?.[0]?.message?.content;
  if (typeof text !== "string") return [];
  text = text.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    try {
      data = start >= 0 ? JSON.parse(text.slice(start, end + 1)) : null;
    } catch {
      return [];
    }
  }
  const list = Array.isArray(data) ? data : data?.titles;
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const title = typeof item?.title === "string" ? item.title.trim() : "";
    if (!title || title.length > 120) continue;
    const year = Number(item.year);
    const type = /series|tv|show/i.test(String(item.type || ""))
      ? "series"
      : "movie";
    const entry = {
      title,
      year:
        Number.isInteger(year) && year >= 1880 && year <= 2100 ? year : null,
      type,
    };
    if (
      !out.some(
        (o) => o.type === type && o.title.toLowerCase() === title.toLowerCase(),
      )
    )
      out.push(entry);
    if (out.length >= AI_LIMIT) break;
  }
  return out;
}

/** The viewer's AI settings as kept in main: provider, key and model. */
export function cleanAiStore(input) {
  if (!input || typeof input !== "object") return null;
  if (!AI_PROVIDERS.some((p) => p.id === input.provider)) return null;
  if (typeof input.key !== "string" || !input.key || input.key.length > 512)
    return null;
  return {
    provider: input.provider,
    key: input.key,
    model: aiModel(input.provider, input.model),
    status: ["ok", "error", "rejected"].includes(input.status)
      ? input.status
      : "untested",
  };
}

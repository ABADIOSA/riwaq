/**
 * Harbor's "Services" page, the Riwaq way.
 *
 * Streaming catalogs: the streaming services TMDB lists for the viewer's
 * region (Netflix, Shahid, OSN+…), each toggled on for the ones they pay for,
 * become home rows of what is popular on that service. They are TMDB discover
 * queries with a watch-provider filter, read with the viewer's own TMDB key.
 *
 * Debrid services: the viewer's own API keys, used only to read their account
 * (premium or not, days left) so an expiry never surprises them. Riwaq does
 * not route playback through these keys. Every request refuses redirects and
 * the keys stay in main. Pure builders and parsers.
 */

export const DEBRID = [
  {
    id: "realdebrid",
    name: "Real-Debrid",
    field: "API token",
    url: "https://real-debrid.com/apitoken",
  },
  {
    id: "alldebrid",
    name: "AllDebrid",
    field: "API key",
    url: "https://alldebrid.com/apikeys/",
  },
  {
    id: "premiumize",
    name: "Premiumize",
    field: "API key",
    url: "https://www.premiumize.me/account",
  },
  {
    id: "torbox",
    name: "TorBox",
    field: "API key",
    url: "https://torbox.app/settings",
  },
  {
    id: "debridlink",
    name: "Debrid-Link",
    field: "API key",
    url: "https://debrid-link.com/webapp/apikey",
  },
];
export const SERVICE_LIMIT = 12;
const DAY = 86400000;

/** The request that reads one debrid account, with the key where it goes. */
export function debridRequest(id, key) {
  const bearer = { headers: { Authorization: `Bearer ${key}` } };
  switch (id) {
    case "realdebrid":
      return { url: "https://api.real-debrid.com/rest/1.0/user", ...bearer };
    case "alldebrid": {
      const url = new URL("https://api.alldebrid.com/v4/user");
      url.searchParams.set("agent", "riwaq");
      return { url: url.toString(), ...bearer };
    }
    case "premiumize": {
      const url = new URL("https://www.premiumize.me/api/account/info");
      url.searchParams.set("apikey", key);
      return { url: url.toString(), headers: {} };
    }
    case "torbox":
      return { url: "https://api.torbox.app/v1/api/user/me", ...bearer };
    case "debridlink":
      return {
        url: "https://debrid-link.com/api/v2/account/infos",
        ...bearer,
      };
    default:
      throw new Error("خدمة غير معروفة");
  }
}

const time = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number")
    return value > 1e12 ? value : value > 1e8 ? value * 1000 : 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * What an account reply says: premium or not, until when, and a name to
 * recognise it by. Anything unexpected reads as "unknown", never as expired.
 */
export function parseDebridAccount(id, body, now = Date.now()) {
  let premium = false;
  let expires = 0;
  let name = "";
  if (id === "realdebrid") {
    premium = body?.type === "premium";
    expires = time(body?.expiration);
    name = body?.username;
  } else if (id === "alldebrid") {
    const user = body?.data?.user;
    premium = user?.isPremium === true;
    expires = time(user?.premiumUntil);
    name = user?.username;
  } else if (id === "premiumize") {
    premium = body?.status === "success" && time(body?.premium_until) > now;
    expires = time(body?.premium_until);
    name = body?.customer_id ? `#${body.customer_id}` : "";
  } else if (id === "torbox") {
    const user = body?.data;
    expires = time(user?.premium_expires_at);
    premium = Number(user?.plan) > 0 && (!expires || expires > now);
    name = user?.email ? String(user.email).replace(/(.).+(@.+)/, "$1…$2") : "";
  } else if (id === "debridlink") {
    const value = body?.value;
    const left = Number(value?.premiumLeft);
    premium = value?.accountType === 1 || left > 0;
    expires = left > 0 ? now + left * 1000 : 0;
    name = value?.pseudo;
  }
  const days = expires ? Math.max(0, Math.ceil((expires - now) / DAY)) : null;
  return {
    status: premium ? (days !== null && days <= 7 ? "soon" : "ok") : "expired",
    days,
    expires: expires || null,
    name: typeof name === "string" ? name.slice(0, 60) : "",
  };
}

/** TMDB's streaming services for a region, most prominent first. */
export function watchProvidersRequest(region) {
  return {
    path: "watch/providers/movie",
    params: { watch_region: region, language: "ar-SA" },
  };
}
export function parseWatchProviders(body) {
  return (Array.isArray(body?.results) ? body.results : [])
    .filter(
      (p) =>
        Number.isInteger(p?.provider_id) &&
        typeof p?.provider_name === "string",
    )
    .sort(
      (a, b) =>
        (a.display_priority ?? 999) - (b.display_priority ?? 999) ||
        a.provider_name.localeCompare(b.provider_name),
    )
    .slice(0, 40)
    .map((p) => ({
      id: p.provider_id,
      name: p.provider_name.slice(0, 60),
      logo:
        typeof p.logo_path === "string" && /^\/[\w.-]+$/.test(p.logo_path)
          ? `https://image.tmdb.org/t/p/w92${p.logo_path}`
          : "",
    }));
}

/** The viewer's chosen services: id, name and logo, validated. */
export function cleanServices(input) {
  const out = [];
  for (const s of Array.isArray(input) ? input : []) {
    const id = Number(s?.id);
    if (!Number.isInteger(id) || id <= 0 || out.some((x) => x.id === id))
      continue;
    const logo =
      typeof s.logo === "string" &&
      /^https:\/\/image\.tmdb\.org\/t\/p\/w92\/[\w.-]+$/.test(s.logo)
        ? s.logo
        : "";
    out.push({
      id,
      name: String(s.name || "").slice(0, 60) || `#${id}`,
      logo,
    });
    if (out.length >= SERVICE_LIMIT) break;
  }
  return out;
}

/** The TMDB sources behind one service's home row: its films and series. */
export function serviceSources(service, region) {
  const filters = {
    withWatchProviders: String(service.id),
    watchRegion: region,
  };
  return ["movie", "tv"].map((media) => ({
    kind: "discover",
    media,
    sort: "popularity.desc",
    title: service.name,
    filters,
  }));
}

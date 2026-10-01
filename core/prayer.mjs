/**
 * Prayer times, computed on the viewer's machine from the sun's position:
 * no network, no location service. The viewer picks a city (or types
 * coordinates) and a calculation method; Umm al-Qura is the default, as in
 * Saudi Arabia. Only places without daylight saving are listed, so a fixed
 * UTC offset is exact all year.
 *
 * The astronomy is the standard one (sun declination and equation of time
 * from the day's Julian date, hour angles for each twilight angle), refined
 * once with the time of day. Pure functions.
 */

export const PRAYERS = [
  ["fajr", "الفجر"],
  ["sunrise", "الشروق"],
  ["dhuhr", "الظهر"],
  ["asr", "العصر"],
  ["maghrib", "المغرب"],
  ["isha", "العشاء"],
];
export const PRAYER_NAMES = Object.fromEntries(PRAYERS);
/** The five prayers (sunrise is a time, not a prayer). */
export const FIVE = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

/** Fajr and Isha angles; Isha may be minutes after Maghrib instead. */
export const PRAYER_METHODS = {
  ummalqura: {
    name: "أم القرى (السعودية)",
    fajr: 18.5,
    ishaMinutes: 90,
    ramadanIsha: 120,
  },
  mwl: { name: "رابطة العالم الإسلامي", fajr: 18, isha: 17 },
  egypt: { name: "الهيئة المصرية العامة للمساحة", fajr: 19.5, isha: 17.5 },
  karachi: { name: "جامعة العلوم الإسلامية، كراتشي", fajr: 18, isha: 18 },
  isna: { name: "الجمعية الإسلامية لأمريكا الشمالية", fajr: 15, isha: 15 },
  dubai: { name: "دبي", fajr: 18.2, isha: 18.2 },
  kuwait: { name: "الكويت", fajr: 18, isha: 17.5 },
  qatar: { name: "قطر", fajr: 18, ishaMinutes: 90 },
};

/** Cities without daylight saving, with their fixed UTC offsets. */
export const PRAYER_CITIES = [
  ["jeddah", "جدة", 21.4858, 39.1925, 3],
  ["makkah", "مكة المكرمة", 21.4225, 39.8262, 3],
  ["madinah", "المدينة المنورة", 24.4672, 39.6111, 3],
  ["riyadh", "الرياض", 24.7136, 46.6753, 3],
  ["dammam", "الدمام", 26.4207, 50.0888, 3],
  ["khobar", "الخبر", 26.2172, 50.1971, 3],
  ["khulais", "خليص", 22.1539, 39.3186, 3],
  ["taif", "الطائف", 21.2703, 40.4158, 3],
  ["yanbu", "ينبع", 24.0895, 38.0618, 3],
  ["tabuk", "تبوك", 28.3835, 36.5662, 3],
  ["abha", "أبها", 18.2164, 42.5053, 3],
  ["jazan", "جازان", 16.8892, 42.5511, 3],
  ["najran", "نجران", 17.565, 44.2289, 3],
  ["hail", "حائل", 27.5114, 41.7208, 3],
  ["buraidah", "بريدة", 26.326, 43.975, 3],
  ["albaha", "الباحة", 20.0129, 41.4677, 3],
  ["jouf", "سكاكا", 29.9697, 40.2064, 3],
  ["kuwait", "الكويت", 29.3759, 47.9774, 3],
  ["doha", "الدوحة", 25.2854, 51.531, 3],
  ["manama", "المنامة", 26.2285, 50.586, 3],
  ["dubai", "دبي", 25.2048, 55.2708, 4],
  ["abudhabi", "أبوظبي", 24.4539, 54.3773, 4],
  ["muscat", "مسقط", 23.588, 58.3829, 4],
  ["amman", "عمّان", 31.9454, 35.9284, 3],
  ["baghdad", "بغداد", 33.3152, 44.3661, 3],
].map(([id, name, lat, lng, tz]) => ({ id, name, lat, lng, tz }));

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const fix = (a, b) => {
  const x = a - b * Math.floor(a / b);
  return x < 0 ? x + b : x;
};

/** The sun's declination and the equation of time for a Julian date. */
function sun(jd) {
  const d = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * d, 360);
  const q = fix(280.459 + 0.98564736 * d, 360);
  const l = fix(
    q + 1.915 * Math.sin(rad(g)) + 0.02 * Math.sin(rad(2 * g)),
    360,
  );
  const e = 23.439 - 0.00000036 * d;
  const ra = fix(
    deg(Math.atan2(Math.cos(rad(e)) * Math.sin(rad(l)), Math.cos(rad(l)))) / 15,
    24,
  );
  return {
    declination: deg(Math.asin(Math.sin(rad(e)) * Math.sin(rad(l)))),
    equation: q / 15 - ra,
  };
}

const julian = (y, m, d) => {
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return (
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    d +
    b -
    1524.5
  );
};

/** Whether a date falls in Ramadan on the Umm al-Qura calendar. */
export function inRamadan(date) {
  try {
    const month = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
      month: "numeric",
      timeZone: "UTC",
    })
      .formatToParts(date)
      .find((p) => p.type === "month")?.value;
    return Number(month) === 9;
  } catch {
    return false;
  }
}

/** A place from settings: a listed city, or the viewer's coordinates. */
export function prayerPlace(settings = {}) {
  if (settings.prayerCity === "custom") {
    const c = settings.prayerCustom || {};
    const lat = Number(c.lat);
    const lng = Number(c.lng);
    const tz = Number(c.tz);
    if (
      Number.isFinite(lat) &&
      Math.abs(lat) <= 66 &&
      Number.isFinite(lng) &&
      Math.abs(lng) <= 180 &&
      Number.isFinite(tz) &&
      tz >= -12 &&
      tz <= 14
    )
      return { id: "custom", name: "موقعك", lat, lng, tz };
  }
  return (
    PRAYER_CITIES.find((c) => c.id === settings.prayerCity) || PRAYER_CITIES[0]
  );
}

/**
 * The day's times for a place, as instants. `date` is any moment of the
 * day wanted, read in the place's own offset.
 */
export function prayerTimes(
  date,
  { lat, lng, tz, method = "ummalqura", asr = "standard" },
) {
  const m = PRAYER_METHODS[method] || PRAYER_METHODS.ummalqura;
  const local = new Date(date.getTime() + tz * 3600000);
  const y = local.getUTCFullYear();
  const mo = local.getUTCMonth() + 1;
  const d = local.getUTCDate();
  const jd = julian(y, mo, d) - lng / (15 * 24);
  const factor = asr === "hanafi" ? 2 : 1;
  const noonAt = (t) => fix(12 - sun(jd + t).equation, 24);
  const angleAt = (angle, t, before) => {
    const { declination } = sun(jd + t);
    const cos =
      (-Math.sin(rad(angle)) -
        Math.sin(rad(declination)) * Math.sin(rad(lat))) /
      (Math.cos(rad(declination)) * Math.cos(rad(lat)));
    if (cos < -1 || cos > 1) return NaN;
    const h = deg(Math.acos(cos)) / 15;
    return noonAt(t) + (before ? -h : h);
  };
  const asrAt = (t) => {
    const { declination } = sun(jd + t);
    const angle = -deg(
      Math.atan(1 / (factor + Math.tan(rad(Math.abs(lat - declination))))),
    );
    return angleAt(angle, t, false);
  };
  // First guesses, then one refinement at each time of day.
  let t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, maghrib: 18, isha: 18 };
  for (let pass = 0; pass < 2; pass++) {
    const p = Object.fromEntries(
      Object.entries(t).map(([k, v]) => [k, v / 24]),
    );
    t = {
      fajr: angleAt(m.fajr, p.fajr, true),
      sunrise: angleAt(0.833, p.sunrise, true),
      dhuhr: noonAt(p.dhuhr),
      asr: asrAt(p.asr),
      maghrib: angleAt(0.833, p.maghrib, false),
      isha: m.isha ? angleAt(m.isha, p.isha, false) : 18,
    };
  }
  if (m.ishaMinutes) {
    const minutes =
      m.ramadanIsha && inRamadan(date) ? m.ramadanIsha : m.ishaMinutes;
    t.isha = t.maghrib + minutes / 60;
  }
  const base = Date.UTC(y, mo - 1, d);
  const out = {};
  for (const [key, hours] of Object.entries(t)) {
    if (!Number.isFinite(hours)) continue;
    // Solar time to the place's clock, rounded to the minute.
    const clock = hours + tz - lng / 15;
    const minutes = Math.round(clock * 60);
    out[key] = new Date(base + (minutes - tz * 60) * 60000);
  }
  return out;
}

/** The next of the five prayers after `now`, looking into tomorrow. */
export function nextPrayer(now, place, options = {}) {
  for (const offset of [0, 1]) {
    const day = new Date(now.getTime() + offset * 86400000);
    const times = prayerTimes(day, { ...place, ...options });
    for (const key of FIVE)
      if (times[key] && times[key] > now)
        return { key, name: PRAYER_NAMES[key], at: times[key] };
  }
  return null;
}

/** The prayers whose time falls between two moments (a viewing's span). */
export function prayersBetween(start, end, place, options = {}) {
  const out = [];
  for (const offset of [0, 1]) {
    const day = new Date(start.getTime() + offset * 86400000);
    const times = prayerTimes(day, { ...place, ...options });
    for (const key of FIVE)
      if (times[key] && times[key] > start && times[key] <= end)
        out.push({ key, name: PRAYER_NAMES[key], at: times[key] });
  }
  return out;
}

/** "3:27 م" in the place's own clock, with Latin digits. */
export function clockAt(date, tz) {
  const local = new Date(date.getTime() + tz * 3600000);
  let h = local.getUTCHours();
  const m = String(local.getUTCMinutes()).padStart(2, "0");
  const suffix = h < 12 ? "ص" : "م";
  h = h % 12 || 12;
  return `${h}:${m} ${suffix}`;
}

/** A runtime as minutes: "2h 46m", "166 min", "58 د" or a number. */
export function runtimeMinutes(value) {
  if (Number.isFinite(value)) return value > 0 ? Math.round(value) : 0;
  const s = String(value || "").toLowerCase();
  const h = Number(s.match(/(\d+)\s*h/)?.[1] || 0);
  const m = Number(s.match(/(\d+)\s*(m|min|د|دقيقة)/)?.[1] || 0);
  if (h || m) return h * 60 + m;
  const bare = Number(s.match(/^\s*(\d{1,3})\s*$/)?.[1] || 0);
  return bare;
}

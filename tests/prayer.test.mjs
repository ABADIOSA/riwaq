import test from "node:test";
import assert from "node:assert/strict";
import {
  PRAYER_CITIES,
  clockAt,
  inRamadan,
  nextPrayer,
  prayerPlace,
  prayerTimes,
  prayersBetween,
  runtimeMinutes,
} from "../core/prayer.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const city = (id) => PRAYER_CITIES.find((c) => c.id === id);
const minutesOf = (date, tz) => {
  const local = new Date(date.getTime() + tz * 3600000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
};

test("every city's day runs Fajr, sunrise, Dhuhr, Asr, Maghrib, Isha in order", () => {
  for (const place of PRAYER_CITIES)
    for (const day of [
      "2026-03-20",
      "2026-06-21",
      "2026-09-23",
      "2026-12-21",
    ]) {
      const t = prayerTimes(new Date(`${day}T09:00:00Z`), place);
      const order = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"].map(
        (k) => t[k],
      );
      assert.ok(order.every(Boolean), `${place.id} ${day}`);
      for (let i = 1; i < order.length; i++)
        assert.ok(order[i] > order[i - 1], `${place.id} ${day} #${i}`);
      // Solar noon in Saudi and the Gulf falls between 11:30 and 12:45.
      const dhuhr = minutesOf(t.dhuhr, place.tz);
      assert.ok(
        dhuhr > 11 * 60 + 15 && dhuhr < 12 * 60 + 50,
        `${place.id} ${day} dhuhr`,
      );
    }
});

test("Umm al-Qura times for Makkah are plausible to the minute", () => {
  // Makkah on the June solstice: about Fajr 4:12, Dhuhr 12:22, Asr 3:42,
  // Maghrib 7:05 (official Umm al-Qura timetables round to the minute).
  const t = prayerTimes(new Date("2026-06-21T09:00:00Z"), city("makkah"));
  const near = (date, h, m) =>
    assert.ok(
      Math.abs(minutesOf(date, 3) - (h * 60 + m)) <= 3,
      `${clockAt(date, 3)} vs ${h}:${m}`,
    );
  near(t.fajr, 4, 12);
  near(t.dhuhr, 12, 22);
  near(t.asr, 15, 42);
  near(t.maghrib, 19, 5);
});

test("Umm al-Qura Isha follows Maghrib by 90 minutes, 120 in Ramadan", () => {
  const normal = prayerTimes(new Date("2026-10-01T09:00:00Z"), city("jeddah"));
  assert.equal((normal.isha - normal.maghrib) / 60000, 90);
  assert.equal(inRamadan(new Date("2027-02-15T12:00:00Z")), true);
  const ramadan = prayerTimes(new Date("2027-02-15T09:00:00Z"), city("jeddah"));
  assert.equal((ramadan.isha - ramadan.maghrib) / 60000, 120);
  const mwl = prayerTimes(new Date("2026-10-01T09:00:00Z"), {
    ...city("jeddah"),
    method: "mwl",
  });
  assert.notEqual((mwl.isha - mwl.maghrib) / 60000, 90, "angle-based Isha");
  const hanafi = prayerTimes(new Date("2026-10-01T09:00:00Z"), {
    ...city("jeddah"),
    asr: "hanafi",
  });
  assert.ok(hanafi.asr > normal.asr, "Hanafi Asr is later");
});

test("the next prayer and the prayers inside a viewing", () => {
  const jeddah = city("jeddah");
  const t = prayerTimes(new Date("2026-10-01T09:00:00Z"), jeddah);
  const afterIsha = new Date(t.isha.getTime() + 60000);
  const next = nextPrayer(afterIsha, jeddah);
  assert.equal(next.key, "fajr");
  assert.ok(next.at > afterIsha);
  const beforeAsr = new Date(t.asr.getTime() - 10 * 60000);
  assert.equal(nextPrayer(beforeAsr, jeddah).key, "asr");
  // A three-hour film started ten minutes before Asr crosses Asr and Maghrib.
  const crossing = prayersBetween(
    beforeAsr,
    new Date(beforeAsr.getTime() + 180 * 60000),
    jeddah,
  );
  assert.deepEqual(
    crossing.map((p) => p.key),
    ["asr", "maghrib"],
  );
  assert.deepEqual(
    prayersBetween(
      beforeAsr,
      new Date(beforeAsr.getTime() + 5 * 60000),
      jeddah,
    ),
    [],
  );
});

test("places, clocks and runtimes", () => {
  assert.equal(prayerPlace({}).id, "jeddah");
  assert.equal(prayerPlace({ prayerCity: "riyadh" }).name, "الرياض");
  assert.equal(
    prayerPlace({
      prayerCity: "custom",
      prayerCustom: { lat: 21.5, lng: 39.2, tz: 3 },
    }).id,
    "custom",
  );
  assert.equal(
    prayerPlace({ prayerCity: "custom", prayerCustom: { lat: 95 } }).id,
    "jeddah",
  );
  assert.equal(clockAt(new Date("2026-10-01T12:37:00Z"), 3), "3:37 م");
  assert.equal(clockAt(new Date("2026-10-01T01:05:00Z"), 3), "4:05 ص");
  assert.equal(runtimeMinutes("2h 46m"), 166);
  assert.equal(runtimeMinutes("47 min"), 47);
  assert.equal(runtimeMinutes("58 د"), 58);
  assert.equal(runtimeMinutes(42), 42);
  assert.equal(runtimeMinutes("unknown"), 0);
});

test("prayer settings are validated", () => {
  assert.equal(DEFAULT_SETTINGS.prayerCity, "jeddah");
  assert.equal(DEFAULT_SETTINGS.prayerPause, false, "pausing is opt-in");
  const s = safeSettings({
    prayerCity: "custom",
    prayerCustom: { lat: "21.48581", lng: 39.19, tz: 3 },
    prayerMethod: "mwl",
    prayerAsr: "hanafi",
    prayerPause: true,
  });
  assert.deepEqual(s.prayerCustom, { lat: 21.4858, lng: 39.19, tz: 3 });
  assert.equal(s.prayerCity, "custom");
  assert.equal(s.prayerMethod, "mwl");
  assert.equal(
    safeSettings({ prayerCity: "custom" }).prayerCity,
    "jeddah",
    "no coordinates, no custom",
  );
  assert.equal(safeSettings({ prayerCity: "mars" }).prayerCity, "jeddah");
  assert.equal(
    safeSettings({ prayerCustom: { lat: 80, lng: 0, tz: 0 } }).prayerCustom,
    null,
  );
});

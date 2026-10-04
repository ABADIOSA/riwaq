/**
 * Runs the full diagnostic on the viewer's machine (core/diagnose.mjs builds
 * and sanitizes the report). Every check has its own timeout and never
 * throws, so one stuck service cannot hold up the rest. Network checks name
 * the service, never an address with a token; addons are reported by name.
 */

import os from "node:os";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { writeFile, readFile, unlink, statfs } from "node:fs/promises";
import { join } from "node:path";
import {
  HEALTH_LABELS,
  classifyHealth,
  duplicateAddons,
  healthSummary,
  isLocalAddon,
} from "../core/addon-health.mjs";
import {
  cleanRendererErrors,
  reportSettings,
  runCheck,
  sanitize,
} from "../core/diagnose.mjs";
import { keyFor } from "../core/protocol.mjs";

const GB = 1024 ** 3;
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Runs a program with a timeout; resolves with its exit code and output. */
export function runProgram(file, args, { timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    let child;
    try {
      child = spawn(file, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch (error) {
      resolve({ code: -1, out: String(error?.message || error) });
      return;
    }
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, out: out.slice(0, 20000) });
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish("timeout");
    }, timeout);
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", (e) => {
      out += String(e?.message || e);
      finish(-1);
    });
    child.on("exit", (code) => finish(code));
  });
}

/** A reachability probe: any HTTP answer means the service is reachable. */
async function probe(fetcher, url, { timeout = 8000, headers = {} } = {}) {
  const started = Date.now();
  const response = await fetcher(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(timeout),
    headers,
  });
  await response.body?.cancel?.().catch(() => {});
  return {
    status: response.status,
    ms: Date.now() - started,
    headers: response.headers,
  };
}

/** Pool of at most `size` promises at a time. */
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * Every addon's manifest, probed at most six at a time: its health by key and
 * name only (core/addon-health.mjs). Used by the Addons page and the report.
 */
export async function probeAddons(
  addons,
  { fetcher = fetch, version = "" } = {},
) {
  const headers = { "User-Agent": `Riwaq/${version} (health)` };
  // Stored addons carry no key: they are named by keyFor(transportUrl), as
  // publicState gives them to the interface and removeAddons matches them.
  const list = (addons || []).map((a) => ({
    ...a,
    key: a.key || keyFor(a.transportUrl),
  }));
  const results = await pool(list, 6, async (a) => {
    let status, ms;
    try {
      const r = await probe(fetcher, a.transportUrl, {
        timeout: 8000,
        headers,
      });
      status = r.status;
      ms = r.ms;
    } catch (error) {
      status = error?.name === "TimeoutError" ? "timeout" : "error";
    }
    return {
      key: a.key,
      name: a.manifest?.name || a.manifest?.id || "?",
      enabled: a.enabled !== false,
      ...classifyHealth({ status, ms, local: isLocalAddon(a.transportUrl) }),
    };
  });
  return { results, duplicates: duplicateAddons(list) };
}

/**
 * The report. `deps` carries what main owns: the Electron app, the client,
 * the MPV executable, safeStorage, screen, the video host, the player and
 * the error log. `rendererErrors` come from the interface.
 */
export async function runDiagnostics(deps) {
  const {
    app,
    client,
    executable,
    safeStorage,
    screen,
    videoHost,
    player,
    errors,
    rendererErrors = [],
    fetcher = fetch,
    run = runProgram,
    userData = app.getPath("userData"),
  } = deps;
  const home = os.homedir();
  const clean = (v, max) => sanitize(v, { home, max });
  const version = app.getVersion();
  const ua = { "User-Agent": `Riwaq/${version} (diagnostics)` };
  const updates = client.updates?.publicState?.(version) || {};
  const traktHeaders = () => {
    try {
      const s = client.integrations?.get?.("trakt");
      return s?.clientId ? client.integrations.traktHeaders(s) : {};
    } catch {
      return {};
    }
  };

  const appInfo = {
    version,
    packaged: app.isPackaged,
    installed: !!updates.installed,
    channel: updates.channel || "",
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    locale: app.getLocale?.() || "",
    uptimeMin: round(process.uptime() / 60),
  };
  let gpu = {};
  try {
    const info = await app.getGPUInfo("basic");
    const device =
      (info?.gpuDevice || []).find((d) => d.active) || info?.gpuDevice?.[0];
    gpu = device
      ? {
          vendorId: `0x${Number(device.vendorId || 0).toString(16)}`,
          deviceId: `0x${Number(device.deviceId || 0).toString(16)}`,
          driver: clean(device.driverVersion || "", 40),
        }
      : {};
  } catch {}
  const displays = (screen?.getAllDisplays?.() || []).map((d) => ({
    size: `${d.size.width}×${d.size.height}`,
    scale: d.scaleFactor,
    depth: d.colorDepth,
    hz: d.displayFrequency || undefined,
    primary: d.id === screen.getPrimaryDisplay?.().id || undefined,
  }));
  const cpus = os.cpus() || [];
  const system = {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: clean(`${cpus[0]?.model?.trim() || "?"} × ${cpus.length}`, 80),
    memoryGB: `${round(os.totalmem() / GB)} (متاح ${round(os.freemem() / GB)})`,
    displays,
    gpu,
    gpuFeatures: (() => {
      try {
        const f = app.getGPUFeatureStatus();
        return {
          gpu_compositing: f.gpu_compositing,
          video_decode: f.video_decode,
          webgl: f.webgl,
          rasterization: f.rasterization,
        };
      } catch {
        return {};
      }
    })(),
  };

  const checks = [];
  const add = async (...args) => checks.push(await runCheck(...args));

  await add("encryption", "تشفير ويندوز (DPAPI)", async () => {
    if (!safeStorage.isEncryptionAvailable())
      return {
        status: "fail",
        detail: "التشفير غير متاح؛ المفاتيح والحسابات لن تُحفظ",
      };
    const back = safeStorage.decryptString(
      safeStorage.encryptString("riwaq-check"),
    );
    return back === "riwaq-check"
      ? { detail: "التشفير وفك التشفير يعملان" }
      : { status: "fail", detail: "فك التشفير أعاد قيمة مختلفة" };
  });

  await add("data", "مجلد البيانات", async () => {
    const probeFile = join(userData, `diagnose-${process.pid}.tmp`);
    await writeFile(probeFile, "riwaq");
    const read = await readFile(probeFile, "utf8");
    await unlink(probeFile);
    if (read !== "riwaq")
      return { status: "fail", detail: "الكتابة والقراءة لا تتطابقان" };
    const data = {};
    try {
      const s = await statfs(userData);
      data.freeGB = round((s.bavail * s.bsize) / GB);
    } catch {}
    try {
      data.profileKB = round(
        statSync(join(userData, "profile.bin")).size / 1024,
      );
    } catch {}
    const low = data.freeGB !== undefined && data.freeGB < 1;
    return {
      status: low ? "warn" : "ok",
      detail: low ? "المساحة الحرة أقل من 1 GB" : "الكتابة والقراءة تعملان",
      data,
    };
  });

  const mpv = executable();
  const mpvCustom = !!client.state.settings.mpvPath;
  await add("mpv-file", "ملف MPV", async () =>
    existsSync(mpv)
      ? { detail: mpvCustom ? "مسار مخصّص" : "المرفق مع رِواق" }
      : {
          status: "fail",
          detail: mpvCustom
            ? "المسار المخصّص غير موجود؛ اختر mpv.exe من الإعدادات"
            : "MPV المرفق غير موجود؛ أعد تثبيت رِواق",
        },
  );
  if (existsSync(mpv)) {
    await add("mpv-version", "إصدار MPV", async () => {
      const r = await run(mpv, ["--no-config", "--version"], {
        timeout: 10000,
      });
      const first = r.out.split(/\r?\n/).find((l) => /mpv/i.test(l)) || "";
      return r.code === 0
        ? { detail: clean(first, 120) }
        : {
            status: "fail",
            detail: clean(`رمز الخروج ${r.code}: ${r.out}`, 300),
          };
    });
    await add(
      "mpv-decode",
      "MPV يفك ويعرض إطارات",
      async () => {
        const r = await run(
          mpv,
          [
            "--no-config",
            "--load-scripts=no",
            "--vo=null",
            "--ao=null",
            "--frames=30",
            "--msg-level=all=error",
            "av://lavfi:testsrc=duration=2:size=640x360:rate=30",
          ],
          { timeout: 20000 },
        );
        return r.code === 0
          ? { detail: "شغّل 30 إطاراً تجريبياً" }
          : {
              status: "fail",
              detail: clean(`رمز الخروج ${r.code}: ${r.out}`, 300),
            };
      },
      { timeout: 25000 },
    );
  }

  await add("video-surface", "سطح الفيديو المدمج", async () => {
    const v = videoHost?.inspect?.();
    if (!v)
      return { status: "skip", detail: "لم يُنشأ بعد؛ يُنشأ مع أول مشاهدة" };
    // Clipping is applied each time the surface is shown, so a hidden surface
    // (no viewing) has nothing to judge yet.
    if (!v.visible)
      return {
        status: v.embedded ? "ok" : "warn",
        detail: v.embedded
          ? "مدمج في نافذة رِواق، ومخفي الآن لعدم وجود مشاهدة؛ شغّل التشخيص أثناء المشاهدة لفحص القص"
          : "السطح غير مدمج في نافذة رِواق",
        data: v,
      };
    const ok = v.embedded && v.siblingsClipped;
    return {
      status: ok ? "ok" : "warn",
      detail: ok
        ? "السطح داخل نافذة رِواق"
        : "السطح غير مدمج أو لا يقص ما فوقه",
      data: v,
    };
  });

  await add("server", "Stremio Service (للتورنت)", async () => {
    const base = client.state.settings.serverUrl;
    try {
      const r = await probe(fetcher, `${base}/settings`, { timeout: 4000 });
      return r.status === 200
        ? { detail: `يستجيب (${r.ms} ms)` }
        : { status: "warn", detail: `ردّ برمز ${r.status}` };
    } catch {
      return {
        status: "warn",
        detail: "لا يعمل. لازم فقط لمصادر التورنت؛ شغّل Stremio Service",
      };
    }
  });

  const services = [
    [
      "net-cinemeta",
      "Cinemeta (فهارس بدون مفتاح)",
      "https://v3-cinemeta.strem.io/manifest.json",
      [200],
    ],
    [
      "net-github",
      "GitHub (التحديثات)",
      "https://api.github.com/repos/ABADIOSA/riwaq/releases?per_page=1",
      [200],
    ],
    [
      "net-tmdb",
      "TMDB",
      "https://api.themoviedb.org/3/configuration",
      [200, 401],
    ],
    ["net-trakt", "Trakt", "https://api.trakt.tv/genres/movies", [200, 401]],
    [
      "net-wikidata",
      "Wikidata (صنّاع العمل)",
      "https://www.wikidata.org/w/api.php?action=query&meta=siteinfo&format=json",
      [200],
    ],
    [
      "net-metahub",
      "صور metahub",
      "https://images.metahub.space/poster/small/tt0111161/img",
      [200, 301, 302],
    ],
  ];
  const netResults = await pool(services, 4, ([id, label, url, okStatus]) =>
    runCheck(
      id,
      label,
      async () => {
        // Trakt answers 403 to any request without the app's client ID, so
        // it is probed with the viewer's own headers when they have one.
        const traktKey = id === "net-trakt" && traktHeaders()["trakt-api-key"];
        const r = await probe(fetcher, url, {
          headers:
            id === "net-trakt"
              ? traktKey
                ? traktHeaders()
                : { ...ua, "trakt-api-version": "2" }
              : ua,
        });
        if (id === "net-trakt" && !traktKey && r.status === 403)
          return { detail: `متاح (${r.ms} ms)؛ يحتاج Client ID للطلبات` };
        if (okStatus.includes(r.status)) {
          const data = {};
          if (id === "net-github") {
            const left = r.headers.get?.("x-ratelimit-remaining");
            if (left !== null && left !== undefined)
              data.rateLeft = Number(left);
          }
          return {
            detail: `متاح (${r.ms} ms)`,
            ...(Object.keys(data).length ? { data } : {}),
            status: id === "net-github" && data.rateLeft === 0 ? "warn" : "ok",
          };
        }
        return {
          status: "warn",
          detail:
            r.status === 403
              ? "ردّ 403 (حجب أو حدّ طلبات)"
              : `ردّ برمز ${r.status} (${r.ms} ms)`,
        };
      },
      { timeout: 10000 },
    ),
  );
  checks.push(...netResults);

  const addons = (client.state.addons || []).filter((a) => a.enabled !== false);
  await add(
    "addons",
    "الإضافات المفعّلة",
    async () => {
      if (!addons.length)
        return { status: "warn", detail: "لا توجد إضافات مفعّلة" };
      const { results, duplicates } = await probeAddons(addons, {
        fetcher,
        version,
      });
      const counts = healthSummary(results);
      const named = (state) =>
        results
          .filter((r) => r.state === state)
          .map((r) => `${clean(r.name, 60)} (${r.status})`)
          .join("، ");
      const parts = [];
      if (counts.gone) parts.push(`${HEALTH_LABELS.gone}: ${named("gone")}`);
      if (counts.down) parts.push(`${HEALTH_LABELS.down}: ${named("down")}`);
      if (counts["needs-server"])
        parts.push(
          `${HEALTH_LABELS["needs-server"]}: ${named("needs-server")}`,
        );
      if (duplicates.length)
        parts.push(
          `مكررة: ${duplicates
            .map((d) =>
              clean(results.find((r) => r.key === d.key)?.name || "?", 60),
            )
            .join("، ")}`,
        );
      const bad = counts.gone + counts.down;
      return {
        status: bad || duplicates.length ? "warn" : "ok",
        detail: parts.length
          ? `${results.length - bad - counts["needs-server"]} من ${results.length} تعمل · ${parts.join(" · ")}`
          : `كلها تستجيب (${results.length})`,
        data: {
          ...counts,
          duplicates: duplicates.length,
          slowest: results
            .filter((r) => r.ms)
            .sort((a, b) => b.ms - a.ms)
            .slice(0, 3)
            .map((r) => ({ name: clean(r.name, 60), ms: r.ms })),
        },
      };
    },
    { timeout: 30000 },
  );

  await add("updates", "التحديثات", async () => {
    const s = updates;
    const status = s.status === "error" ? "warn" : "ok";
    return {
      status,
      detail:
        s.status === "error"
          ? clean(`آخر فحص فشل: ${s.error || ""} ${s.detail || ""}`, 200)
          : s.available
            ? `يتوفر ${s.latest?.version || "إصدار"}`
            : "لا يوجد إصدار أحدث",
      data: {
        enabled: s.enabled !== false,
        channel: s.channel,
        checkedAt: s.checkedAt ? new Date(s.checkedAt).toISOString() : "",
      },
    };
  });

  const state = client.publicState?.() || {};
  const connected = (state.integrations || [])
    .filter((i) => i.connected)
    .map((i) => i.id);
  const providers = (state.providers || [])
    .filter((p) => p.configured)
    .map((p) => `${p.id}${p.enabled ? "" : " (موقوف)"}`);
  const profile = state.profiles?.list?.find(
    (p) => p.id === state.profiles?.active,
  );
  const counts = {
    addons: `${addons.length} مفعّلة من ${(client.state.addons || []).length}`,
    profiles: state.profiles?.list?.length || 0,
    activeProfileProtected: !!profile?.protected,
    favorites: (client.state.favorites || []).length,
    progress: Object.keys(client.state.progress || {}).length,
    collections: (client.state.collections || []).length,
    queue: (client.state.queue || []).length,
    liveSources: (state.live?.sources || []).length,
    providers: providers.join("، ") || "لا يوجد",
    integrations: connected.join("، ") || "لا يوجد",
    player: player?.state?.active
      ? `يعمل${player.state.error ? `، خطأ: ${clean(player.state.error, 120)}` : ""}`
      : "متوقف",
  };

  return {
    generatedAt: new Date().toISOString(),
    app: appInfo,
    system,
    checks,
    counts,
    settings: reportSettings(client.state.settings),
    errors: {
      main: errors?.list?.() || [],
      renderer: cleanRendererErrors(rendererErrors, { home }),
    },
  };
}

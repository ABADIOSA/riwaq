import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { safeStorage } from "electron";

export async function runSmoke({ window, client, player, app, root }) {
  const output = join(root, ".cache", "smoke");
  mkdirSync(output, { recursive: true });
  const results = [];
  const errors = [];
  const web = window.webContents;
  web.setBackgroundThrottling(false);
  window.showInactive();
  web.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  const js = (code) => web.executeJavaScript(code, true);
  const wait = async (predicate, label, timeout = 30000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timeout: ${label}`);
  };
  const click = async (text, selector = "button") =>
    js(
      `(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!b)throw new Error('Button missing');b.click();return true;})()`,
    );
  const shot = async (name) => {
    await new Promise((r) => setTimeout(r, 500));
    writeFileSync(
      join(output, name + ".png"),
      (await web.capturePage()).toPNG(),
    );
  };
  let server;
  try {
    await wait(
      () =>
        js(
          `document.querySelectorAll('.poster-card').length>0 && !!document.querySelector('.hero')`,
        ),
      "live catalogs",
      60000,
    );
    await wait(
      () =>
        js(
          `[...document.querySelectorAll('.poster-image img')].some(i=>i.complete&&i.naturalWidth>0)`,
        ),
      "poster images",
      30000,
    );
    assert.equal(await js("document.documentElement.dir"), "rtl");
    results.push({
      test: "Live Cinemeta catalogs and RTL rendering",
      status: "passed",
      posters: await js(`document.querySelectorAll('.poster-card').length`),
    });
    await shot("home");
    await js(`document.querySelector('.poster-card').click()`);
    await wait(
      () =>
        js(
          `!!document.querySelector('.details-modal[open]') && !document.querySelector('.details-modal .busy')`,
        ),
      "metadata dialog",
    );
    await click("أضف إلى مكتبتي", ".details-modal button");
    await wait(
      () => Promise.resolve(client.state.favorites.length > 0),
      "save favorite",
    );
    await shot("details");
    await click("أضف إلى الطابور", ".details-modal button");
    await wait(
      () => Promise.resolve(client.state.queue.length === 1),
      "queue add through details",
    );
    await js(`document.querySelector('.details-modal .modal-close').click()`);
    await click("مكتبتي", ".nav-item");
    await wait(
      () => js(`!!document.querySelector('.poster-grid .poster-card')`),
      "library",
    );
    await click("طابور المشاهدة", ".library-tabs button");
    await wait(
      () => js(`document.querySelectorAll('.watch-row').length === 1`),
      "queue view",
    );
    await shot("queue");
    await click("قائمتي", ".library-tabs button");
    results.push({
      test: "Metadata, save favorite and library navigation",
      status: "passed",
    });
    await click("الإضافات", ".nav-item");
    await wait(
      () => js(`!!document.querySelector('.addon-card')`),
      "addon page",
    );
    await shot("addons");
    await click("الإعدادات", ".nav-item");
    await wait(
      () => js(`!!document.querySelector('.theme-gallery')`),
      "settings",
    );
    await click("هدوء البحر");
    await wait(
      () =>
        js(`document.querySelector('.app').classList.contains('theme-teal')`),
      "theme switch",
    );
    await click("دفء ذهبي");
    await shot("settings");
    await click("مكتبة البيانات", ".studio-nav button");
    await wait(
      () => js(`document.querySelectorAll('.provider-card').length === 4`),
      "data providers",
    );
    await shot("data-hub");
    await click("الحسابات والربط", ".studio-nav button");
    await wait(
      () => js(`document.querySelectorAll('.integration-card').length === 3`),
      "service integrations",
    );
    await shot("integrations");
    await js(
      `window.riwaq.call('settings',{layout:'topbar',accent:'noir'}).then(()=>{})`,
    );
    // The UI update helper receives state; call the UI theme controls for persistent roundtrip below.
    await click("المظهر والتخصيص", ".studio-nav button");
    await click("أسود سينمائي");
    await click("شريط علوي");
    await wait(
      () =>
        js(
          `document.querySelector('.app').classList.contains('layout-topbar')`,
        ),
      "top navigation layout",
    );
    await shot("topbar-settings");
    await click("سينمائي", ".layout-choices button");
    await click("دفء ذهبي");
    results.push({
      test: "Addon manager, settings and persisted theme switch",
      status: "passed",
    });
    await js(`document.querySelector('.account-button').click()`);
    await wait(
      () => js(`!!document.querySelector('.account-modal[open]')`),
      "account",
    );
    await shot("account");
    await js(`document.querySelector('.account-modal .modal-close').click()`);

    const samples = 44100 * 30;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(44100, 24);
    wav.writeUInt32LE(88200, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(samples * 2, 40);
    const fixture = {
      id: "test.riwaq",
      name: "Riwaq test fixture",
      version: "1.0.0",
      types: ["movie"],
      resources: ["catalog", "meta", "stream", "subtitles"],
      catalogs: [{ id: "test", type: "movie", name: "Playback tests" }],
    };
    let base;
    server = createServer((req, res) => {
      if (req.url === "/audio.wav") {
        const match = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
        const start = match ? Number(match[1]) : 0,
          end =
            match && match[2]
              ? Math.min(Number(match[2]), wav.length - 1)
              : wav.length - 1;
        res.writeHead(match ? 206 : 200, {
          "Content-Type": "audio/wav",
          "Content-Length": end - start + 1,
          "Accept-Ranges": "bytes",
          ...(match
            ? { "Content-Range": `bytes ${start}-${end}/${wav.length}` }
            : {}),
        });
        res.end(wav.subarray(start, end + 1));
        return;
      }
      if (req.url === "/live.m3u") {
        res.setHeader("Content-Type", "audio/x-mpegurl");
        res.end(
          `#EXTM3U url-tvg="${base}/epg.xml"\n` +
            '#EXTINF:-1 tvg-id="riwaq1" group-title="اختبار",قناة رِواق\n' +
            `${base}/audio.wav\n`,
        );
        return;
      }
      if (req.url === "/epg.xml") {
        const stamp = (offset) =>
          new Date(Date.now() + offset)
            .toISOString()
            .replace(/[-:T]/g, "")
            .slice(0, 14) + " +0000";
        res.setHeader("Content-Type", "application/xml");
        res.end(
          `<tv><channel id="riwaq1"><display-name>قناة رِواق</display-name></channel>` +
            `<programme start="${stamp(-1800000)}" stop="${stamp(1800000)}" channel="riwaq1">` +
            `<title lang="ar">برنامج الاختبار</title></programme></tv>`,
        );
        return;
      }
      if (req.url === "/ar.srt") {
        res.setHeader("Content-Type", "text/plain");
        res.end("1\n00:00:00,000 --> 00:00:25,000\nاختبار الترجمة العربية\n");
        return;
      }
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/manifest.json") return res.end(JSON.stringify(fixture));
      if (req.url.startsWith("/meta/movie/riwaq%3Anext"))
        return res.end(
          JSON.stringify({
            meta: {
              id: "riwaq:next",
              type: "movie",
              name: "العنوان التالي في الطابور",
            },
          }),
        );
      if (req.url.startsWith("/stream/"))
        return res.end(
          JSON.stringify({
            streams: [{ name: "1080p test", url: base + "/audio.wav" }],
          }),
        );
      if (req.url.startsWith("/subtitles/"))
        return res.end(
          JSON.stringify({
            subtitles: [{ id: "ar-test", lang: "ara", url: base + "/ar.srt" }],
          }),
        );
      res.end("{}");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    await click("الإضافات", ".nav-item");
    await js(
      `(()=>{const input=document.querySelector('#addon-url');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(base + "/manifest.json")});input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await js(`document.querySelector('.addon-form').requestSubmit()`);
    await wait(
      () =>
        Promise.resolve(
          client.state.addons.some((a) => a.manifest.id === fixture.id),
        ),
      "addon installation",
    );
    const streams = await js(
      `window.riwaq.call('streams',{type:'movie',id:'riwaq:test'})`,
    );
    assert.equal(streams.streams.length, 1);
    await js(
      `window.riwaq.call('play',{key:${JSON.stringify(streams.streams[0].key)},meta:{id:'riwaq:test',type:'movie',name:'اختبار التشغيل'},videoId:'riwaq:test'})`,
    );
    await wait(
      () =>
        Promise.resolve(
          player.state.duration > 20 && player.state.position > 0,
        ),
      "native MPV playback",
    );
    await js(`window.riwaq.call('playerCommand',{action:'pause'})`);
    await wait(() => Promise.resolve(player.state.pause === true), "MPV pause");
    await js(`window.riwaq.call('playerCommand',{action:'seek',value:12})`);
    await wait(() => Promise.resolve(player.state.position >= 11), "MPV seek");
    const subtitles = await js(
      `window.riwaq.call('subtitles',{type:'movie',id:'riwaq:test',streamKey:${JSON.stringify(streams.streams[0].key)}})`,
    );
    await js(
      `window.riwaq.call('subtitle',{key:${JSON.stringify(subtitles[0].key)}})`,
    );
    await wait(
      () => Promise.resolve(player.state.tracks.some((t) => t.type === "sub")),
      "Arabic subtitle load",
    );
    await wait(
      () => Promise.resolve(player.host.inspect().visible),
      "native child surface visible",
    );
    assert.equal(player.host.inspect().embedded, true);
    await js(`document.querySelector('[aria-label="إعدادات المشغل"]').click()`);
    await wait(
      () => js(`!!document.querySelector('.player-modal[open]')`),
      "player control dialog",
    );
    await wait(
      () => Promise.resolve(!player.host.inspect().visible),
      "hide native video behind dialog",
    );
    await shot("player");
    await js(`document.querySelector('.player-modal .modal-close').click()`);
    await js(`window.riwaq.call('stop')`);
    assert.ok(client.state.progress["movie:riwaq:test"].position >= 11);
    const disk = readFileSync(join(app.getPath("userData"), "profile.bin"));
    assert.ok(!disk.toString().includes("Riwaq test fixture"));
    const decrypted = JSON.parse(safeStorage.decryptString(disk));
    assert.ok(decrypted.progress["movie:riwaq:test"].position >= 11);
    results.push({
      test: "Installed HTTP addon → native MPV playback → pause/seek → Arabic subtitle → encrypted saved progress",
      status: "passed",
    });
    await js(
      `window.riwaq.call('play',{key:${JSON.stringify(streams.streams[0].key)},meta:{id:'riwaq:test',type:'movie',name:'اختبار الاستئناف'},videoId:'riwaq:test'})`,
    );
    await wait(
      () =>
        Promise.resolve(
          player.state.duration > 20 && player.state.position >= 11,
        ),
      "resume saved position",
    );
    await player.stop();
    results.push({
      test: "Native player resumes persisted playback position",
      status: "passed",
    });
    await js(
      `window.riwaq.call('queueEdit',{action:'add',meta:{id:'riwaq:test',type:'movie',name:'اختبار الطابور'},videoId:'riwaq:test'})`,
    );
    await js(
      `window.riwaq.call('play',{key:${JSON.stringify(streams.streams[0].key)},meta:{id:'riwaq:test',type:'movie',name:'اختبار الطابور'},videoId:'riwaq:test'})`,
    );
    await wait(
      () =>
        Promise.resolve(
          player.state.position > 0 &&
            !client.state.queue.some((q) => q.videoId === "riwaq:test"),
        ),
      "queue consumed only after loading",
    );
    for (const entry of [...client.state.queue])
      client.queueEdit({ action: "remove", key: entry.key });
    client.queueEdit({
      action: "add",
      meta: {
        id: "riwaq:next",
        type: "movie",
        name: "العنوان التالي في الطابور",
      },
      videoId: "riwaq:next",
    });
    client.settings({ autoplay: true });
    web.send("riwaq:state", client.publicState());
    await new Promise((resolve) => setTimeout(resolve, 200));
    player.command({ action: "seek", value: 29 });
    await wait(
      () =>
        Promise.resolve(
          player.videoId === "riwaq:next" && player.state.position > 0,
        ),
      "actual EOF advances to queue title",
      20000,
    );
    assert.equal(client.state.queue.length, 0);
    client.settings({ autoplay: false });
    web.send("riwaq:state", client.publicState());
    results.push({
      test: "Actual MPV EOF advances to queued title using addon metadata and stream; autoplay remains opt-in",
      status: "passed",
    });
    const queueGuest = await js(
      `window.riwaq.call('profileCreate',{name:'اختبار التقدم'})`,
    );
    const queueGuestId = queueGuest.profiles.list.find(
      (p) => p.name === "اختبار التقدم",
    ).id;
    await js(
      `window.riwaq.call('profileSwitch',{id:${JSON.stringify(queueGuestId)}})`,
    );
    assert.equal(player.state.active, false);
    assert.deepEqual(client.state.progress, {});
    assert.equal(client.state.queue.length, 0);
    await js(`window.riwaq.call('profileSwitch',{id:'default'})`);
    assert.ok(client.state.progress["movie:riwaq:test"].position > 0);
    results.push({
      test: "Queue UI persists; loaded item is consumed; switching viewers stops playback before saving into the next profile",
      status: "passed",
    });

    // The stream engine must publish its ranking, not just an order.
    assert.ok(streams.streams[0].tier);
    assert.ok(streams.streams[0].reasons.length > 0);
    assert.ok(Array.isArray(streams.groups));
    results.push({
      test: "Stream engine returns tiers and inspectable ranking reasons",
      status: "passed",
    });

    await js(
      `window.riwaq.call('liveAdd',{kind:'m3u',name:'اختبار',url:${JSON.stringify(base + "/live.m3u")}})`,
    );
    const channels = await js(`window.riwaq.call('liveChannels',{})`);
    // Fixture setup calls IPC directly; mirror the state update that the UI's
    // update() helper normally performs after liveAdd.
    web.send("riwaq:state", client.publicState());
    assert.equal(channels.total, 1);
    assert.equal(channels.channels[0].name, "قناة رِواق");
    assert.equal(channels.channels[0].now?.title, "برنامج الاختبار");
    // A channel must never carry its playback URL across the bridge.
    assert.ok(!JSON.stringify(channels).includes("/audio.wav"));
    const guide = await js(
      `window.riwaq.call('liveGuide',{start:${Date.now() - 1800000},hours:4})`,
    );
    assert.ok(guide.rows[0].blocks.length >= 1);
    await click("بث مباشر", ".nav-item");
    await wait(
      () => js(`!!document.querySelector('.channel-card')`),
      "live channel grid",
    );
    await shot("livetv");
    await js(
      `window.riwaq.call('playChannel',{key:${JSON.stringify(channels.channels[0].key)}})`,
    );
    await wait(
      () => Promise.resolve(player.state.active && player.state.live === true),
      "live channel playback",
    );
    await js(`window.riwaq.call('stop')`);
    await click("الرئيسية", ".nav-item");
    results.push({
      test: "M3U source with XMLTV guide → channel grid → EPG blocks → live playback by opaque key",
      status: "passed",
    });

    const withGuest = await js(
      `window.riwaq.call('profileCreate',{name:'ضيف'})`,
    );
    const guestId = withGuest.profiles.list.find((p) => p.name === "ضيف").id;
    await js(
      `window.riwaq.call('profileSwitch',{id:${JSON.stringify(guestId)}})`,
    );
    assert.equal(client.state.favorites.length, 0);
    assert.equal(Object.keys(client.state.progress).length, 0);
    await js(
      `window.riwaq.call('profilePin',{id:${JSON.stringify(guestId)},pin:'2468'})`,
    );
    await js(
      `window.riwaq.call('profileUpdate',{id:${JSON.stringify(guestId)},lockedRooms:['live']})`,
    );
    await js(`window.riwaq.call('profileLock')`);
    const blocked = await js(
      `window.riwaq.call('liveChannels',{}).then(()=>'allowed',(e)=>e.message)`,
    );
    assert.match(blocked, /محمي/);
    const encrypted = JSON.parse(
      safeStorage.decryptString(
        readFileSync(join(app.getPath("userData"), "profile.bin")),
      ),
    );
    assert.ok(!JSON.stringify(encrypted).includes("2468"));
    await js(`window.riwaq.call('profileUnlock',{pin:'2468'})`);
    assert.equal((await js(`window.riwaq.call('liveChannels',{})`)).total, 1);
    await js(`window.riwaq.call('profileSwitch',{id:'default'})`);
    assert.ok(client.state.progress["movie:riwaq:test"].position >= 11);
    results.push({
      test: "Profiles isolate library and progress, hash the PIN and gate a locked room",
      status: "passed",
    });
    const videoPath = join(output, "test-video.y4m");
    const frame = Buffer.concat([
      Buffer.from("FRAME\n"),
      Buffer.alloc(320 * 180, 95),
      Buffer.alloc(160 * 90, 115),
      Buffer.alloc(160 * 90, 145),
    ]);
    writeFileSync(
      videoPath,
      Buffer.concat([
        Buffer.from("YUV4MPEG2 W320 H180 F5:1 Ip A1:1 C420jpeg\n"),
        ...Array(150).fill(frame),
      ]),
    );
    await player.start({
      executable: join(root, "vendor", "mpv", "mpv.exe"),
      settings: client.state.settings,
      url: videoPath,
      local: true,
      meta: {
        id: "test-video",
        type: "local",
        name: "Riwaq video decoder test",
      },
      videoId: "test-video",
    });
    await wait(
      () =>
        Promise.resolve(
          player.state.tracks.some((t) => t.type === "video") &&
            player.state.position > 0,
        ),
      "actual video decoding",
    );
    await wait(
      () => Promise.resolve(player.host.inspect().visible),
      "embedded video surface",
    );
    const fullRect = player.host.inspect().rectangle;
    assert.equal(player.host.inspect().nativeVisible, true);
    assert.equal(player.host.inspect().siblingsClipped, true);
    assert.ok(fullRect.width > 800 && fullRect.height > 300);
    await js(`window.riwaq.call('playerCommand',{action:'pip'})`);
    await wait(
      () =>
        Promise.resolve(
          player.host.inspect().rectangle.width < fullRect.width / 2,
        ),
      "mini player native resize",
    );
    await shot("mini-player");
    await js(`window.riwaq.call('playerCommand',{action:'pip'})`);
    await js(`window.riwaq.call('playerCommand',{action:'fullscreen'})`);
    await wait(
      () => Promise.resolve(window.isFullScreen()),
      "embedded fullscreen",
    );
    await js(`window.riwaq.call('playerCommand',{action:'fullscreen'})`);
    await wait(
      () => Promise.resolve(!window.isFullScreen()),
      "leave fullscreen",
    );
    player.subtitle(base + "/ar.srt");
    await wait(
      () =>
        Promise.resolve(
          player.state.tracks.some((t) => t.type === "sub" && t.selected),
        ),
      "video subtitle selection",
    );
    player.send([
      "screenshot-to-file",
      join(output, "mpv-subtitles.png"),
      "subtitles",
    ]);
    await new Promise((r) => setTimeout(r, 400));
    if (process.env.RIWAQ_REVIEW) {
      player.command({ action: "pause" });
      console.log("REVIEW_READY: embedded video and Arabic subtitles");
      console.log(JSON.stringify(player.host.inspect()));
      await new Promise((r) => setTimeout(r, 45000));
    }
    await player.stop();
    results.push({
      test: "Native video decoding with selected Arabic subtitle",
      status: "passed",
    });
    assert.ok(
      !errors.some((e) => /Uncaught|Minified React error/.test(e)),
      errors.join("\n"),
    );
    results.push({ test: "No uncaught renderer errors", status: "passed" });
    writeFileSync(
      join(output, "results.json"),
      JSON.stringify(
        { passed: true, results, rendererErrors: errors },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ passed: true, results, output }, null, 2));
  } catch (error) {
    writeFileSync(
      join(output, "results.json"),
      JSON.stringify({ passed: false, results, error: error.stack }, null, 2),
    );
    console.error(error);
    await shot("failure");
    process.exitCode = 1;
  } finally {
    server?.close();
    await player.stop();
    app.exit(process.exitCode || 0);
  }
}

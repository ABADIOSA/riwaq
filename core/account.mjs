/**
 * Riwaq accounts: optional, end-to-end encrypted sync of a viewer's data
 * between the desktop app, other PCs and the web edition (docs/ACCOUNTS.md).
 *
 * Nothing changes for a viewer who never makes an account. One who does
 * signs in with a username and password; what syncs is exactly what a
 * backup carries (core/backup.mjs collectBackup): profiles with their
 * library, progress, collections and settings, hotkeys and plain addons.
 * Keys and connected accounts join only when the viewer turns that on, for
 * the whole account.
 *
 * Keys, all derived on the device:
 * - scrypt(password, username) → master; HMAC(master, "auth") is the proof
 *   sent to the server (stored there only as a peppered hash), HMAC(master,
 *   "wrap") never leaves the device.
 * - A random data key encrypts the account's data (AES-256-GCM over gzip).
 *   The server keeps it wrapped by the password's wrap key, and wrapped by
 *   a recovery code shown once at sign-up.
 * - Forgetting both the password and the recovery code loses the account's
 *   data on the server; the copy on each device stays.
 *
 * Syncing pulls first, merges with the last agreed version
 * (core/sync-merge.mjs) and pushes only real changes, at most every half
 * minute (two while watching), and at once when the app closes.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { collectBackup, restoreState } from "./backup.mjs";
import { merge3, same } from "./sync-merge.mjs";
import { ACCOUNT_SERVER } from "./account-server.mjs";

export const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
export const MIN_PASSWORD = 10;
const KDF = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAGIC = Buffer.from("RWQ1");
// A change goes up within half a minute, or two while a viewing saves its
// position every few seconds (each upload is a few database writes).
const PUSH_DELAY = 30000;
const PUSH_DELAY_WATCHING = 120000;
const PULL_EVERY = 5 * 60000;

// --- Inputs ------------------------------------------------------------------

export function normalizeUsername(input) {
  const name = String(input ?? "")
    .trim()
    .toLowerCase();
  if (!USERNAME.test(name))
    throw new Error(
      "اسم المستخدم من 3 إلى 32 حرفاً إنجليزياً صغيراً أو رقماً، ويمكن أن يحتوي . أو _ أو -",
    );
  return name;
}

export function checkNewPassword(password) {
  if (typeof password !== "string" || [...password].length < MIN_PASSWORD)
    throw new Error(`اختر كلمة مرور من ${MIN_PASSWORD} أحرف على الأقل`);
  if (password.length > 256) throw new Error("كلمة المرور طويلة جداً");
}

/** 24 Crockford base32 characters (120 bits) in six groups of four. */
export function newRecoveryCode(random = randomBytes) {
  const bytes = random(15);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g).join("-");
}

/** The code as typed: case, spaces, dashes and look-alike letters forgiven. */
export function normalizeRecoveryCode(input) {
  const code = String(input ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (code.length !== 24 || [...code].some((c) => !BASE32.includes(c)))
    throw new Error(
      "رمز الاسترداد غير صحيح: 24 حرفاً ورقماً كما ظهر لك وقت التسجيل",
    );
  return code;
}

// --- Keys --------------------------------------------------------------------

const b64url = (buffer) => Buffer.from(buffer).toString("base64url");
const hmac = (key, label) => createHmac("sha256", key).update(label).digest();

/** The password's proof for the server and its wrap key for this device. */
export function deriveAccountKeys(username, password) {
  const salt = createHash("sha256")
    .update(`riwaq-account-v1\u0000${username}`)
    .digest();
  return new Promise((resolve, reject) =>
    scrypt(
      String(password).normalize("NFKC"),
      salt,
      64,
      KDF,
      (error, master) =>
        error
          ? reject(error)
          : resolve({
              authSecret: b64url(hmac(master, "auth")),
              wrapKey: hmac(master, "wrap"),
            }),
    ),
  );
}

/** The recovery code's proof and wrap key (the code is already random). */
export function recoveryKeys(username, code) {
  const master = createHmac("sha256", normalizeRecoveryCode(code))
    .update(`riwaq-recovery-v1\u0000${username}`)
    .digest();
  return {
    recoveryAuth: b64url(hmac(master, "auth")),
    wrapKey: hmac(master, "wrap"),
  };
}

function seal(key, plain, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}
function unseal(key, sealed, aad) {
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([
    decipher.update(sealed.subarray(12, sealed.length - 16)),
    decipher.final(),
  ]);
}

export const wrapKey = (wrap, dataKey, username, kind) =>
  b64url(seal(wrap, dataKey, `riwaq-account-v1:${kind}:${username}`));
export function unwrapKey(wrap, wrapped, username, kind) {
  try {
    const key = unseal(
      wrap,
      Buffer.from(String(wrapped), "base64url"),
      `riwaq-account-v1:${kind}:${username}`,
    );
    if (key.length !== 32) throw new Error();
    return key;
  } catch {
    throw new Error(
      kind === "recovery" ? "رمز الاسترداد غير صحيح" : "كلمة المرور غير صحيحة",
    );
  }
}

/** The account's data as the server stores it: base64 of a sealed gzip. */
export function sealData(dataKey, username, envelope) {
  const sealed = seal(
    dataKey,
    gzipSync(Buffer.from(JSON.stringify(envelope))),
    `riwaq-sync-v1:${username}`,
  );
  return Buffer.concat([MAGIC, sealed]).toString("base64");
}
export function openData(dataKey, username, text) {
  const raw = Buffer.from(String(text), "base64");
  if (!raw.subarray(0, 4).equals(MAGIC))
    throw new Error("بيانات الحساب بصيغة غير معروفة؛ حدّث رِواق");
  let envelope;
  try {
    envelope = JSON.parse(
      gunzipSync(
        unseal(dataKey, raw.subarray(4), `riwaq-sync-v1:${username}`),
        { maxOutputLength: 256 * 1024 * 1024 },
      ).toString("utf8"),
    );
  } catch {
    throw new Error("تعذّر فتح بيانات الحساب؛ سجّل الدخول من جديد");
  }
  if (envelope?.format !== "riwaq-sync" || envelope.version !== 1)
    throw new Error("بيانات الحساب من إصدار أحدث من رِواق؛ حدّث التطبيق");
  return envelope;
}

// --- The server ----------------------------------------------------------------

/** HTTPS, or plain HTTP to this machine for development and tests. */
export function serverUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      !(url.protocol === "https:" || (url.protocol === "http:" && loopback))
    )
      return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export async function accountFetch(url, { timeout = 20000, ...init } = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...init,
      // A session token must never follow a redirect elsewhere.
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new Error(
      "ما قدرنا نوصل لخادم حسابات رِواق. تحقق من الاتصال ثم جرّب مجدداً.",
    );
  }
  return {
    status: response.status,
    revision: response.headers.get("X-Riwaq-Revision"),
    text: await response.text(),
  };
}

const PROBLEMS = {
  invalid_credentials: "اسم المستخدم أو كلمة المرور غير صحيحة",
  wrong_password: "كلمة المرور الحالية غير صحيحة",
  taken: "اسم المستخدم مأخوذ؛ اختر اسماً ثانياً",
  rate_limited: "محاولات كثيرة؛ انتظر ربع ساعة ثم جرّب مجدداً",
  too_large: "بياناتك أكبر من حد الحساب (قرابة 5 ميجابايت)",
  unauthorized: "انتهت جلستك؛ سجّل الدخول من جديد",
  bad_request: "الطلب غير صالح؛ حدّث رِواق ثم جرّب مجدداً",
  forbidden_origin: "هذه الصفحة غير مسموح لها بالوصول للحسابات",
};
export function accountProblem(status, code) {
  const error = new Error(
    PROBLEMS[code] ||
      (status >= 500
        ? "خادم حسابات رِواق ما رد؛ جرّب بعد شوي"
        : `تعذّر إكمال العملية (رمز ${status})`),
  );
  error.status = status;
  error.code = code || "";
  return error;
}

// --- The hub -------------------------------------------------------------------

export class AccountHub {
  constructor(
    client,
    {
      server = ACCOUNT_SERVER,
      request = accountFetch,
      now = () => Date.now(),
    } = {},
  ) {
    this.client = client;
    this.server = serverUrl(server);
    this.request = request;
    this.now = now;
    this.running = null;
    this.epoch = 0;
    this.deferred = false;
    this.deferredPrefer = null;
    this.playbackActive = () => !!this.watching;
    this.applying = false;
    this.error = "";
    this.onChange = () => {};
  }
  /** What this device keeps for the account, inside its encrypted store. */
  get bag() {
    const bag = this.client.state.account;
    return bag?.token ? bag : null;
  }
  publicState() {
    const bag = this.bag;
    return {
      available: !!this.server,
      signedIn: !!bag,
      username: bag?.username || this.client.state.accountName || "",
      lastSync: bag?.lastSync || null,
      syncing: !!bag && this.runningBag === bag && !!this.running,
      deferred: !!bag && this.deferred,
      secrets: !!bag?.secrets,
      error: this.error,
    };
  }

  async api(method, path, { json, text, token, headers = {}, conflict } = {}) {
    if (!this.server) throw new Error("حسابات رِواق غير متاحة في هذه النسخة");
    const response = await this.request(`${this.server}${path}`, {
      method,
      headers: {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(text !== undefined ? { "Content-Type": "text/plain" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json ? JSON.stringify(json) : text,
    });
    let data = null;
    if (response.text && /^\s*[{[]/.test(response.text))
      try {
        data = JSON.parse(response.text);
      } catch {}
    if (response.status >= 400 && !(conflict && response.status === 409))
      throw accountProblem(response.status, data?.error);
    return { ...response, data };
  }

  /** The data that syncs, as a detached copy (never live references). */
  collect(secrets) {
    this.client.profiles.capture();
    return JSON.parse(
      JSON.stringify(
        collectBackup(this.client.state, { includeSecrets: !!secrets }).payload,
      ),
    );
  }

  /** Puts the account's data on this device, keeping its own profile choice. */
  apply(payload) {
    const client = this.client;
    const profiles = client.profiles;
    const active = profiles.store.active;
    const pin = JSON.stringify(profiles.active()?.pin || null);
    const unlocked = profiles.unlocked;
    this.applying = true;
    try {
      profiles.capture();
      client.state = restoreState(client.state, payload);
      if (client.state.profiles.list.some((p) => p.id === active))
        client.state.profiles.active = active;
      profiles.ensure();
      // An unlocked profile stays unlocked only if it is the same profile
      // with the same PIN; anything else starts locked, as after a restore.
      profiles.unlocked =
        profiles.store.active === active &&
        JSON.stringify(profiles.active()?.pin || null) === pin
          ? unlocked
          : !profiles.active()?.pin;
      client.cache.clear();
      client.persist();
    } finally {
      this.applying = false;
    }
  }

  /** Signs this device in with a fresh session and data key. */
  begin(username, token, dataKey, secrets = false) {
    this.epoch++;
    this.running = null;
    this.runningBag = null;
    this.deferred = false;
    this.deferredPrefer = null;
    this.client.state.account = {
      username,
      token,
      key: dataKey.toString("base64"),
      revision: 0,
      secrets: !!secrets,
      lastSync: null,
    };
    this.client.state.accountName = username;
    this.error = "";
    this.client.persist();
  }

  /** Bind asynchronous sign-in to this attempt and the originating profile. */
  attempt() {
    const epoch = ++this.epoch;
    const owner = this.client.profiles.store.active;
    return () => {
      if (this.epoch !== epoch || this.client.profiles.store.active !== owner)
        throw new Error("تغيّرت جلسة الحساب؛ أعد المحاولة");
      this.client.profiles.gate("settings");
    };
  }

  async signup({ username, password, secrets = false } = {}) {
    this.client.profiles.gate("settings");
    const current = this.attempt();
    const name = normalizeUsername(username);
    checkNewPassword(password);
    const keys = await deriveAccountKeys(name, password);
    current();
    const dataKey = randomBytes(32);
    const recoveryCode = newRecoveryCode();
    const recovery = recoveryKeys(name, recoveryCode);
    const { data } = await this.api("POST", "/v1/signup", {
      json: {
        username: name,
        authSecret: keys.authSecret,
        wrappedKey: wrapKey(keys.wrapKey, dataKey, name, "password"),
        recoveryAuth: recovery.recoveryAuth,
        recoveryKey: wrapKey(recovery.wrapKey, dataKey, name, "recovery"),
      },
    });
    current();
    this.begin(name, data.token, dataKey, secrets === true);
    const bag = this.bag;
    // The account exists from here; a failed first upload is retried later.
    await this.sync().catch(() => {});
    if (this.bag !== bag) throw new Error("تغيّرت جلسة الحساب؛ أعد المحاولة");
    return { recoveryCode, state: this.client.publicState() };
  }

  async login({ username, password } = {}) {
    this.client.profiles.gate("settings");
    const current = this.attempt();
    const name = normalizeUsername(username);
    if (typeof password !== "string" || !password)
      throw new Error("اكتب كلمة المرور");
    const keys = await deriveAccountKeys(name, password);
    current();
    const { data } = await this.api("POST", "/v1/login", {
      json: { username: name, authSecret: keys.authSecret },
    });
    current();
    const dataKey = unwrapKey(keys.wrapKey, data.wrappedKey, name, "password");
    this.begin(name, data.token, dataKey);
    const bag = this.bag;
    // The account's data wins over this device's where both set something.
    await this.sync({ prefer: "remote" });
    if (this.bag !== bag) throw new Error("تغيّرت جلسة الحساب؛ أعد المحاولة");
    return this.client.publicState();
  }

  async recover({ username, code, password } = {}) {
    this.client.profiles.gate("settings");
    const current = this.attempt();
    const name = normalizeUsername(username);
    const recovery = recoveryKeys(name, code);
    checkNewPassword(password);
    const start = await this.api("POST", "/v1/recover/start", {
      json: { username: name, recoveryAuth: recovery.recoveryAuth },
    });
    current();
    const dataKey = unwrapKey(
      recovery.wrapKey,
      start.data.recoveryKey,
      name,
      "recovery",
    );
    const keys = await deriveAccountKeys(name, password);
    current();
    const { data } = await this.api("POST", "/v1/recover/finish", {
      json: {
        username: name,
        recoveryAuth: recovery.recoveryAuth,
        authSecret: keys.authSecret,
        wrappedKey: wrapKey(keys.wrapKey, dataKey, name, "password"),
      },
    });
    current();
    this.begin(name, data.token, dataKey);
    const bag = this.bag;
    await this.sync({ prefer: "remote" });
    if (this.bag !== bag) throw new Error("تغيّرت جلسة الحساب؛ أعد المحاولة");
    return this.client.publicState();
  }

  async changePassword({ password, newPassword } = {}) {
    this.client.profiles.gate("settings");
    const bag = this.bag;
    if (!bag) throw new Error("سجّل الدخول أولاً");
    checkNewPassword(newPassword);
    const [current, next] = await Promise.all([
      deriveAccountKeys(bag.username, String(password || "")),
      deriveAccountKeys(bag.username, newPassword),
    ]);
    if (this.bag !== bag) throw new Error("تغيّرت جلسة الحساب؛ أعد المحاولة");
    this.client.profiles.gate("settings");
    const dataKey = Buffer.from(bag.key, "base64");
    await this.proving(
      () =>
        this.api("POST", "/v1/password", {
          token: bag.token,
          json: {
            authSecret: current.authSecret,
            newAuthSecret: next.authSecret,
            wrappedKey: wrapKey(
              next.wrapKey,
              dataKey,
              bag.username,
              "password",
            ),
          },
        }),
      bag,
    );
    return this.client.publicState();
  }

  /** Signs this device out; its data stays here as it is. */
  async logout() {
    this.client.profiles.gate("settings");
    const bag = this.bag;
    // Local sign-out takes effect immediately, even if the network is slow.
    this.end();
    if (bag)
      await this.api("POST", "/v1/logout", { token: bag.token }).catch(
        () => {},
      );
    return this.client.publicState();
  }

  async deleteAccount({ password } = {}) {
    this.client.profiles.gate("settings");
    const bag = this.bag;
    if (!bag) throw new Error("سجّل الدخول أولاً");
    const keys = await deriveAccountKeys(bag.username, String(password || ""));
    if (this.bag !== bag) throw new Error("تغيّرت جلسة الحساب؛ أعد المحاولة");
    this.client.profiles.gate("settings");
    await this.proving(
      () =>
        this.api("DELETE", "/v1/account", {
          token: bag.token,
          json: { authSecret: keys.authSecret },
        }),
      bag,
    );
    if (this.bag === bag) this.end();
    return this.client.publicState();
  }

  /** Keys and connected accounts in the account's data, for every device. */
  async configure({ secrets } = {}) {
    this.client.profiles.gate("settings");
    const bag = this.bag;
    if (!bag) throw new Error("سجّل الدخول أولاً");
    if (typeof secrets === "boolean" && secrets !== bag.secrets) {
      bag.secrets = secrets;
      bag.secretsChanged = true;
      this.client.persist();
      await this.sync();
      if (this.bag === bag && bag.secretsChanged && !this.deferred)
        await this.sync();
    }
    return this.client.publicState();
  }

  /** A request that proves the password of a signed-in account. */
  async proving(send, bag = this.bag) {
    try {
      return await send();
    } catch (error) {
      if (error.code === "invalid_credentials")
        throw accountProblem(401, "wrong_password");
      if (error.code === "unauthorized" && this.bag === bag) this.end();
      throw error;
    }
  }

  end() {
    this.epoch++;
    this.running = null;
    this.runningBag = null;
    this.error = "";
    this.deferred = false;
    this.deferredPrefer = null;
    clearTimeout(this.pushTimer);
    this.pushTimer = null;
    this.client.state.account = null;
    this.client.persist();
    this.onChange();
  }

  // --- Syncing -----------------------------------------------------------------

  /** Remote profile/settings changes wait until the video process has ended. */
  playbackChanged(active) {
    this.watching = !!active;
    if (this.deferred && !this.playbackActive()) this.sync().catch(() => {});
  }

  /** Called on every save: a change goes up within a minute. */
  touch() {
    if (!this.started || this.applying || !this.bag || this.pushTimer) return;
    this.pushTimer = setTimeout(
      () => {
        this.pushTimer = null;
        this.sync().catch(() => {});
      },
      this.watching ? PUSH_DELAY_WATCHING : PUSH_DELAY,
    );
    this.pushTimer.unref?.();
  }

  /** The window came back: look for changes, at most every half minute. */
  nudge() {
    if (!this.bag || this.now() - (this.nudged || 0) < 30000) return;
    this.nudged = this.now();
    this.sync().catch(() => {});
  }

  /** Sends a waiting change now (closing the app, hiding the page). */
  flush() {
    if (!this.pushTimer) return this.running || Promise.resolve();
    clearTimeout(this.pushTimer);
    this.pushTimer = null;
    return this.sync().catch(() => {});
  }

  /** Regular pulls while the app runs; main and the web bridge call it. */
  start() {
    if (this.started) return;
    this.started = true;
    this.pullTimer = setInterval(() => this.sync().catch(() => {}), PULL_EVERY);
    this.pullTimer.unref?.();
    if (this.bag) this.sync().catch(() => {});
  }
  stop() {
    this.started = false;
    clearInterval(this.pullTimer);
    clearTimeout(this.pushTimer);
    this.pushTimer = null;
  }

  async pull(bag) {
    const response = await this.api("GET", "/v1/data", {
      token: bag.token,
      headers:
        bag.base !== undefined && bag.revision
          ? { "If-None-Match": String(bag.revision) }
          : {},
    });
    const revision = Number(response.revision) || 0;
    if (response.status === 304 || response.status === 204)
      return { revision, envelope: null };
    return {
      revision,
      envelope: openData(
        Buffer.from(bag.key, "base64"),
        bag.username,
        response.text,
      ),
    };
  }

  /**
   * Pull, merge, push. Serialized: a call during a sync waits for it.
   * `prefer` decides real conflicts ("remote" right after signing in).
   */
  sync({ prefer = this.deferredPrefer || "local" } = {}) {
    if (!this.bag) return Promise.resolve(this.client.publicState());
    const bag = this.bag;
    if (this.running && this.runningBag === bag) return this.running;
    this.runningBag = bag;
    const running = this.run(prefer)
      .finally(() => {
        if (this.running !== running) return;
        this.running = null;
        this.runningBag = null;
        this.onChange();
        if (this.deferred && !this.playbackActive() && !this.error)
          queueMicrotask(() => this.sync().catch(() => {}));
      })
      // IPC applies this result after onChange: do not put an old "syncing"
      // snapshot back into the interface once the request has finished.
      .then(() => this.client.publicState());
    this.running = running;
    this.onChange();
    return this.running;
  }

  async run(prefer) {
    const bag = this.bag;
    try {
      for (let round = 0; round < 4; round++) {
        if (this.bag !== bag) return this.client.publicState();
        const pulled = await this.pull(bag);
        if (this.bag !== bag) return this.client.publicState();
        if (pulled.envelope) {
          const remote = pulled.envelope.payload;
          const secrets = bag.secretsChanged
            ? bag.secrets
            : !!pulled.envelope.secrets;
          const local = this.collect(secrets);
          const merged = merge3(bag.base, local, remote, { prefer });
          if (!same(merged, local) && this.playbackActive()) {
            this.deferred = true;
            this.deferredPrefer = prefer;
            this.error = "";
            return this.client.publicState();
          }
          bag.secrets = secrets;
          if (!same(merged, local)) {
            this.apply(merged);
            this.onChange("remote");
          }
          bag.base = remote;
          bag.revision = pulled.revision;
        } else if (pulled.revision === 0) {
          bag.revision = 0;
          bag.base = undefined;
        }
        this.deferred = false;
        this.deferredPrefer = null;
        const local = this.collect(bag.secrets);
        if (
          !bag.secretsChanged &&
          bag.base !== undefined &&
          same(local, bag.base)
        ) {
          bag.lastSync = this.now();
          this.error = "";
          this.client.persist();
          return this.client.publicState();
        }
        const secrets = !!bag.secrets;
        const text = sealData(Buffer.from(bag.key, "base64"), bag.username, {
          format: "riwaq-sync",
          version: 1,
          secrets,
          app: this.client.version || "",
          at: this.now(),
          payload: local,
        });
        const pushed = await this.api("PUT", "/v1/data", {
          token: bag.token,
          conflict: true,
          text,
          headers: { "X-Riwaq-Base": String(bag.revision || 0) },
        });
        if (this.bag !== bag) return this.client.publicState();
        if (pushed.status === 409) continue; // Another device moved first.
        bag.revision = Number(pushed.data?.revision) || bag.revision + 1;
        bag.base = local;
        bag.secretsChanged = bag.secrets !== secrets;
        bag.lastSync = this.now();
        this.error = "";
        this.client.persist();
        return this.client.publicState();
      }
      throw new Error(
        "تعذّرت المزامنة بسبب تعديلات متزامنة؛ نعيد المحاولة لاحقاً",
      );
    } catch (error) {
      if (this.bag !== bag) return this.client.publicState();
      this.error = error.message;
      // An expired or revoked session signs this device out; data stays.
      if (error.status === 401 && this.bag === bag) this.end();
      throw error;
    }
  }
}

import { verify, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { REPO, parseVersion, compareVersions } from "./updates.mjs";

export const MANIFEST_NAME = "riwaq-update.json";
export const MAX_MANIFEST = 100_000;
export const MAX_PACKAGE = 2 * 1024 ** 3;

export function installerName(version) {
  if (!parseVersion(version) || !/^[0-9][0-9A-Za-z.-]{4,79}$/.test(version))
    throw new Error("رقم إصدار التحديث غير صالح");
  return `Riwaq-Setup-${version}-win-x64.exe`;
}

export function assetUrl(version, filename = MANIFEST_NAME) {
  installerName(version);
  if (![MANIFEST_NAME, installerName(version)].includes(filename))
    throw new Error("ملف التحديث غير مسموح");
  return `https://github.com/${REPO}/releases/download/v${version}/${filename}`;
}

/** Verify the exact signed bytes before parsing or trusting any field. */
export function verifyManifest(
  text,
  publicKey,
  { version, channel = "beta" } = {},
) {
  if (typeof text !== "string" || Buffer.byteLength(text) > MAX_MANIFEST)
    throw new Error("بيانات التحديث غير صالحة");
  let data;
  try {
    const envelope = JSON.parse(text);
    if (
      typeof envelope.payload !== "string" ||
      typeof envelope.signature !== "string"
    )
      throw 0;
    const bytes = Buffer.from(envelope.payload, "base64");
    const signature = Buffer.from(envelope.signature, "base64");
    if (signature.length !== 64 || !verify(null, bytes, publicKey, signature))
      throw 0;
    data = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("تعذّر التحقق من توقيع التحديث؛ لن يتم تثبيته");
  }
  if (
    data.schema !== 1 ||
    data.repo !== REPO ||
    data.platform !== "win32-x64" ||
    (version && data.version !== version) ||
    data.filename !== installerName(data.version) ||
    !["stable", "beta"].includes(data.channel) ||
    (channel === "stable" &&
      (data.channel !== "stable" || parseVersion(data.version).pre.length)) ||
    typeof data.sha512 !== "string" ||
    !/^[a-f0-9]{128}$/.test(data.sha512) ||
    !Number.isSafeInteger(data.size) ||
    data.size < 1 ||
    data.size > MAX_PACKAGE ||
    typeof data.notes !== "string" ||
    data.notes.length > 20000 ||
    !Number.isFinite(Date.parse(data.publishedAt))
  )
    throw new Error("حزمة التحديث لا تطابق هذا التطبيق أو قناة الإصدارات");
  return data;
}

/** No cached filename or renderer value is ever used as a path. */
export async function verifyInstaller(path, manifest) {
  const info = await stat(path);
  if (!info.isFile() || info.size !== manifest.size)
    throw new Error("حجم ملف التحديث غير صحيح؛ أعد تنزيله");
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest("hex") !== manifest.sha512)
    throw new Error("ملف التحديث غير مكتمل أو تغير؛ أعد تنزيله");
  return true;
}

export function eligiblePackage(manifest, current, channel = "beta") {
  return (
    compareVersions(manifest.version, current) > 0 &&
    (channel !== "stable" ||
      (manifest.channel === "stable" &&
        !parseVersion(manifest.version).pre.length))
  );
}

/** GitHub's asset redirects are anonymous and restricted to its asset hosts. */
export function updateUrlAllowed(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return false;
    if (
      [
        "release-assets.githubusercontent.com",
        "objects.githubusercontent.com",
      ].includes(url.hostname)
    )
      return true;
    return (
      url.hostname === "github.com" &&
      url.pathname.startsWith(`/${REPO}/releases/download/`)
    );
  } catch {
    return false;
  }
}

export async function fetchUpdate(url, { signal, fetcher = fetch } = {}) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!updateUrlAllowed(url))
      throw new Error("عنوان تنزيل التحديث غير مسموح");
    const response = await fetcher(url, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "Riwaq-Updater" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get("location"), url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      const error = new Error(
        "تعذّر تنزيل التحديث؛ تحقق من الاتصال وحاول مجدداً",
      );
      error.status = response.status;
      throw error;
    }
    return response;
  }
  throw new Error("تعذّر الوصول إلى ملف التحديث");
}

export async function readManifest(url, { signal, fetcher } = {}) {
  const response = await fetchUpdate(url, { signal, fetcher });
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_MANIFEST)
      throw new Error("بيانات التحديث أكبر من الحد المسموح");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

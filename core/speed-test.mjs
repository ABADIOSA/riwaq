/**
 * "Measure this connection" (Harbor's speed test): a short download from
 * Cloudflare's public speed endpoint, timed from the first byte, so the
 * viewer can pick a speed cap that matches their real line. Only run when
 * the viewer presses the button; nothing about the viewer is sent.
 */
import { BANDWIDTH_CAPS } from "./stream-engine.mjs";

export const SPEED_URL = "https://speed.cloudflare.com/__down?bytes=40000000";

/**
 * Downloads for at most `maxMs` and returns megabits a second, or throws an
 * Arabic sentence. `fetch` and `now` are injectable for tests.
 */
export async function measureDownload({
  fetch: get = globalThis.fetch,
  url = SPEED_URL,
  maxMs = 8000,
  now = () => performance.now(),
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxMs + 4000);
  let bytes = 0;
  let first = 0;
  let last = 0;
  try {
    const response = await get(url, {
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok || !response.body)
      throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const at = now();
      if (!first) first = at;
      else bytes += value.byteLength;
      last = at;
      if (at - first >= maxMs) {
        controller.abort();
        break;
      }
    }
  } catch (error) {
    if (!(last - first > 500 && bytes > 0))
      throw new Error("تعذّر قياس السرعة. تحقق من الإنترنت ثم أعد المحاولة.", {
        cause: error,
      });
  } finally {
    clearTimeout(timer);
  }
  const seconds = (last - first) / 1000;
  if (seconds < 0.3 || bytes <= 0)
    throw new Error("القياس كان أقصر من أن يعتمد عليه. أعد المحاولة.");
  return Math.round(((bytes * 8) / seconds / 1_000_000) * 10) / 10;
}

/** The highest cap the measured speed keeps comfortably above (85%). */
export function suggestCap(mbps) {
  const caps = BANDWIDTH_CAPS.filter(Boolean);
  const fits = caps.filter((cap) => cap <= mbps * 0.85);
  return fits.length ? fits[fits.length - 1] : caps[0];
}

/**
 * A sign-in popup coming back to the site: Stremio's (after `login`) or
 * Spotify's (after `spotifyConnect`). The answer is handed to the tab that
 * asked, over a same-origin BroadcastChannel; that tab checks the nonce.
 * The address bar is cleaned at once so the code does not linger in history.
 */
export function readCallback(href) {
  const url = new URL(href);
  const params = url.searchParams;
  // Stremio appends the key to the callback address it was given; it may
  // arrive as a second "?" when the callback already had a query.
  const nonce = /[?&]riwaq-login=([a-f0-9]{48})/.exec(href)?.[1];
  if (nonce) {
    const authKey =
      /[?&]authKey=([^&#]+)/.exec(href)?.[1] ||
      /[?&]key=([^&#]+)/.exec(href)?.[1];
    return {
      kind: "stremio",
      nonce,
      authKey: authKey ? decodeURIComponent(authKey) : "",
    };
  }
  const state = params.get("state");
  if (
    state &&
    /^[a-f0-9]{48}$/.test(state) &&
    (params.has("code") || params.has("error"))
  )
    return {
      kind: "spotify",
      state,
      code: params.get("code") || "",
      error: params.get("error") || "",
    };
  return null;
}

export function deliverCallback(answer) {
  history.replaceState(null, "", location.pathname);
  const channel = new globalThis.BroadcastChannel("riwaq-callback");
  channel.postMessage(answer);
  channel.close();
  const ok =
    answer.kind === "stremio"
      ? !!answer.authKey
      : answer.kind === "spotify" && !!answer.code;
  document.getElementById("root").innerHTML = "";
  const box = document.createElement("div");
  box.className = "web-boot";
  box.textContent = ok
    ? "تم. ارجع إلى تبويب رِواق؛ هذه النافذة تُغلق الآن."
    : "ما اكتمل الربط. ارجع إلى رِواق وجرّب مجدداً.";
  document.getElementById("root").append(box);
  setTimeout(() => window.close(), 1200);
}

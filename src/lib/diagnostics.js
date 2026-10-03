/**
 * The interface's recent errors, for the full diagnostic report. Messages
 * are trimmed here and sanitized again in main (core/diagnose.mjs) before
 * they enter a report; nothing is sent anywhere unless the viewer runs the
 * diagnostic and shares the result.
 */
const LIMIT = 40;
const recent = [];

export function recordError(where, error) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error?.message || error || "");
  recent.push({
    at: new Date().toISOString(),
    where: String(where).slice(0, 60),
    message: message.slice(0, 300),
  });
  if (recent.length > LIMIT) recent.shift();
}

export const recentErrors = () => [...recent];

/** Uncaught errors and rejected promises in the page. */
export function watchErrors(target = window) {
  target.addEventListener("error", (e) =>
    recordError(
      `ui:${(e.filename || "").split("/").pop() || "page"}`,
      e.error || e.message,
    ),
  );
  target.addEventListener("unhandledrejection", (e) =>
    recordError("ui:promise", e.reason),
  );
}

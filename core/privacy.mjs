/**
 * Riwaq's privacy policy (PRIVACY.md in English, PRIVACY.ar.md in Arabic,
 * at the repository root). The app links to the published files and shows
 * a short summary in Settings → System → Privacy; the summary must say
 * nothing the policy does not. Browser-safe.
 */
export const POLICY_VERSION = "1.0";
export const POLICY_DATE = "2026-11-01";
const BASE = "https://github.com/ABADIOSA/riwaq/blob/main";
/** Fixed pages main and the web bridge open through `openService`. */
export const PRIVACY_URLS = {
  privacy: `${BASE}/PRIVACY.md`,
  privacyAr: `${BASE}/PRIVACY.ar.md`,
};
/** The policy page in the interface language. */
export const privacyLink = (lang) => (lang === "en" ? "privacy" : "privacyAr");

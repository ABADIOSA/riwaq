/**
 * Dates and times in the interface language (core/i18n.mjs): each caller
 * names the Arabic locale it writes in (Gregorian, Latin digits), and
 * English uses British English with the same calendar and digits.
 */
import { language } from "../../core/i18n.mjs";

export const loc = (arabic = "ar-SA-u-ca-gregory-nu-latn") =>
  language() === "en" ? "en-GB" : arabic;

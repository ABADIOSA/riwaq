/**
 * English for Riwaq's interface, keyed by the Arabic text the code shows
 * (core/i18n.mjs). `{name}` marks a part filled in at run time. Each area
 * keeps its own file under en/, built from scripts/i18n-strings.mjs.
 */
import core from "./en/core.mjs";
import library from "./en/library.mjs";
import settings from "./en/settings.mjs";
import settingsPlayer from "./en/settings-player.mjs";
import settingsContent from "./en/settings-content.mjs";
import settingsMore from "./en/settings-more.mjs";
import sentences from "./en/sentences.mjs";
import mainMessages from "./en/main.mjs";
import messages from "./en/messages.mjs";
import shell from "./en/shell.mjs";
import title from "./en/title.mjs";

export default {
  ...core,
  ...library,
  ...settings,
  ...settingsPlayer,
  ...settingsContent,
  ...settingsMore,
  ...sentences,
  ...mainMessages,
  ...messages,
  ...shell,
  ...title,
  الإعدادات: "Settings",
};

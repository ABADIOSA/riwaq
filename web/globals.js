/**
 * Node globals that core/ reaches for (Buffer in backups, profiles and
 * theme codes). Imported first by web/main.jsx.
 */
import { Buffer } from "./shims/buffer.js";

globalThis.Buffer ||= Buffer;

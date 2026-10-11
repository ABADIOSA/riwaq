/**
 * Discord Rich Presence talks to the Discord app over a local pipe, which a
 * web page cannot open. core/presence.mjs only connects when the viewer turns
 * presence on; the web edition hides that control.
 */
const unavailable = () => {
  throw new Error("حالة Discord متاحة في نسخة سطح المكتب فقط");
};
export const createConnection = unavailable;
export const connect = unavailable;
export default { createConnection, connect };

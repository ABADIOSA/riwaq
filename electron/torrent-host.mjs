/**
 * The built-in torrent engine's own process (Electron's utilityProcess):
 * electron/torrent.mjs sends {id, method, args} and gets {id, result} or
 * {id, error} back. Only the engine's own methods are callable.
 */
import { startEngine } from "./torrent-engine.mjs";

const METHODS = ["url", "release", "configure", "stats", "clear", "close"];
const port = process.parentPort;
let engine = null;

port.on("message", async ({ data }) => {
  const { id, method, args = [] } = data || {};
  try {
    let result;
    if (method === "start") {
      engine ||= await startEngine({
        ...args[0],
        log: (error) =>
          port.postMessage({ log: String(error?.message || error) }),
      });
      result = { origin: engine.origin };
    } else if (engine && METHODS.includes(method)) {
      result = await engine[method](...args);
      // Only Electron's utility process ends itself (tests load this too).
      if (method === "close" && process.type === "utility")
        setTimeout(() => process.exit(0), 50);
    } else throw new Error("محرك التورنت لم يبدأ");
    port.postMessage({ id, result });
  } catch (error) {
    port.postMessage({ id, error: String(error?.message || error) });
  }
});

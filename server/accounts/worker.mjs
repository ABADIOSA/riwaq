/**
 * The Worker's entry (wrangler.toml `main`): its handlers and nothing else.
 * Every named export of a Worker's main module is read as an entrypoint,
 * and a value that is not a handler stops the runtime (workerd: "Incorrect
 * type for map entry"), so the service and its constants live in
 * service.mjs (database audit 2026-11-18, CF5).
 */
import { cleanup, handle } from "./service.mjs";

export default {
  scheduled: (_event, env, context) => context.waitUntil(cleanup(env.DB)),
  fetch: (request, env) => handle(request, env),
};

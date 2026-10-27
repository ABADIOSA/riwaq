import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));

// JSX goes through src/lib/jsx-runtime.js, which applies the interface
// language (core/i18n.mjs) to every element as it renders.
export const jsxLanguage = {
  plugin: { jsxImportSource: "riwaq-jsx" },
  alias: {
    "riwaq-jsx/jsx-runtime": here("./src/lib/jsx-runtime.js"),
    "riwaq-jsx/jsx-dev-runtime": here("./src/lib/jsx-dev-runtime.js"),
  },
};
// plugin-react explicitly includes its JSX runtime in dependency optimization.
// Our runtime is application code with shared i18n state, not a dependency:
// bundling it separately would create a second language singleton in dev.
export const translatingRuntime = {
  name: "riwaq-shared-language-runtime",
  configResolved(config) {
    const aliases = Object.keys(jsxLanguage.alias);
    config.optimizeDeps.include = (config.optimizeDeps.include || []).filter(
      (id) => !aliases.includes(id),
    );
    config.optimizeDeps.exclude = [
      ...new Set([...(config.optimizeDeps.exclude || []), ...aliases]),
    ];
  },
};

export default defineConfig({
  base: "./",
  plugins: [react(jsxLanguage.plugin), translatingRuntime],
  resolve: { alias: jsxLanguage.alias },
  build: { outDir: "dist" },
});

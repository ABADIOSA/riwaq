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

export default defineConfig({
  base: "./",
  plugins: [react(jsxLanguage.plugin)],
  resolve: { alias: jsxLanguage.alias },
  build: { outDir: "dist" },
});

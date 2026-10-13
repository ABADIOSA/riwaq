/**
 * The web edition (docs/WEB.md): the same interface (src/) and core/ as the
 * desktop app, built for a browser. web/ holds only what differs: the page,
 * the bridge that stands in for electron/main.mjs, the HTML5 player and the
 * browser versions of the few Node modules core/ uses.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { jsxLanguage } from "./vite.config.mjs";

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const { version } = JSON.parse(readFileSync(here("./package.json"), "utf8"));

/** Files the site serves beside the page: its version, manifest and icon. */
function siteFiles() {
  return {
    name: "riwaq-site-files",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ version }),
      });
      this.emitFile({
        type: "asset",
        fileName: "icon.png",
        source: readFileSync(here("./assets/icon.png")),
      });
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: JSON.stringify(
          {
            name: "رِواق — Riwaq",
            short_name: "رِواق",
            description:
              "رِواق على الويب: عميل عربي لإضافات Stremio بدون تحميل برنامج.",
            lang: "ar",
            dir: "rtl",
            start_url: "./",
            scope: "./",
            display: "standalone",
            background_color: "#111316",
            theme_color: "#111316",
            icons: [{ src: "icon.png", sizes: "512x512", type: "image/png" }],
          },
          null,
          2,
        ),
      });
    },
  };
}

export default defineConfig({
  root: here("./web"),
  base: "./",
  publicDir: false,
  plugins: [react(jsxLanguage.plugin), siteFiles()],
  define: {
    "import.meta.env.RIWAQ_VERSION": JSON.stringify(version),
    // Empty unless a test or a developer points the site at a local
    // account service; the deployed site uses core/account-server.mjs.
    "import.meta.env.RIWAQ_ACCOUNT_SERVER": JSON.stringify(
      process.env.RIWAQ_ACCOUNT_SERVER || "",
    ),
  },
  resolve: {
    alias: {
      ...jsxLanguage.alias,
      "node:crypto": here("./web/shims/crypto.js"),
      "node:zlib": here("./web/shims/zlib.js"),
      "node:net": here("./web/shims/net.js"),
    },
  },
  server: { host: "127.0.0.1", fs: { allow: [here(".")] } },
  build: {
    outDir: here("./dist-web"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});

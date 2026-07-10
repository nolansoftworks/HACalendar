import { defineConfig } from "vite";
import { resolve } from "node:path";

// Output lands directly in the dev HA instance's www/ directory, so a
// `npm run watch` rebuild is immediately live at /local/hacalendar/.
const OUT_DIR = "dev/config/www/hacalendar";

export default defineConfig({
  // Relative base: the bundle is served from /local/hacalendar/, not the root.
  base: "./",

  build: {
    // Fire OS 7 ships Amazon's Chromium WebView, reported as low as 87 on
    // un-updated 7.3.x devices. This is the floor for the whole project.
    //
    // NOTE: this transpiles *syntax* only. Built-ins newer than Chrome 87
    // (.at(), Object.hasOwn(), structuredClone()) pass the build and throw
    // on the tablet. Don't use them; there is no safety net here.
    target: "chrome87",
    outDir: OUT_DIR,
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        // Mount point 1: loaded by panel_custom inside the HA frontend.
        panel: resolve(__dirname, "src/panel.ts"),
        // Mount point 2: standalone page for browsers too old to boot HA's UI.
        index: resolve(__dirname, "index.html"),
      },
      output: {
        // panel_custom needs a stable module_url, so no content hashes.
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },

  server: {
    port: 5173,
  },
});

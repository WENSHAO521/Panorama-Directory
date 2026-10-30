// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import { satteri } from "@astrojs/markdown-satteri";

export default defineConfig({
  site: "https://profiles.panorama-sg.com",
  // Emit /directory.html and /board/<slug>.html so every URL from the old
  // static site keeps resolving.
  build: { format: "file" },
  trailingSlash: "never",
  // Keep bios exactly as written (no automatic curly quotes or dashes).
  markdown: { processor: satteri({ features: { smartPunctuation: false } }) },
  vite: { plugins: [tailwindcss()] },
});

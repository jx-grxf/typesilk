import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

/**
 * /me is the app itself, but its content lives in one browser's storage, so it gets a real
 * file with noindex. Every other unknown path can then be a real 404.
 */
function profilePage(): Plugin {
  const canonical = /<link rel="canonical"[^>]*>/;
  return {
    name: "typesilk-profile-page",
    apply: "build",
    closeBundle() {
      const app = readFileSync("dist/index.html", "utf8");
      if (!canonical.test(app)) throw new Error("index.html lost its canonical link");
      writeFileSync("dist/me.html", app.replace(canonical, '<meta name="robots" content="noindex" />'));
    },
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [profilePage()],
  build: {
    rollupOptions: {
      input: { main: "index.html", design: "design.html", about: "about.html", de: "de.html", notFound: "404.html", daily: "daily.html", privacy: "privacy.html", datenschutz: "datenschutz.html", terms: "terms.html", nutzungsbedingungen: "nutzungsbedingungen.html", impressum: "impressum.html", race: "race.html" },
    },
  },
});

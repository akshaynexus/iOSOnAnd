import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fumadocsMdx } from "fumadocs-mdx/vite";

// Dev server: PORT env (default 3000). host: true listens on every address,
// IPv4 and IPv6, so http://localhost (::1 first on some machines) and
// http://127.0.0.1 both work. strictPort fails loudly instead of moving to
// another port that the CLI's TRACKER_URL would not point at.
const port = Number(process.env.PORT) || 3000;

// GET /cli.mjs is a Worker route (src/routes/cli[.]mjs.ts, cli.mjs imported
// ?raw). In dev, Vite's own transform middleware would answer that URL first
// (cli.mjs exists in the root, so Vite serves it as a rewritten browser
// module), so this dev-only middleware serves the file as is, ahead of it.
const cliRaw: Plugin = {
  name: "iosonand-cli-raw",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if ((req.url || "").split("?")[0] !== "/cli.mjs") return next();
      res.setHeader("content-type", "text/javascript; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      res.end(req.method === "HEAD" ? undefined : readFileSync(path.join(server.config.root, "cli.mjs")));
    });
  },
};

export default defineConfig({
  server: { host: true, port, strictPort: true },
  preview: { host: true, port, strictPort: true },
  plugins: [
    cliRaw,
    // Compiles content/docs/*.mdx into JS modules at build time (the
    // defineDocs macro in src/lib/source.ts), so /docs needs no fs at runtime.
    fumadocsMdx(),
    tsconfigPaths(),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
    // Builds the SSR environment into the Worker. Keep the server bundle
    // lean: no heavy top-level imports (Workers 128 MB / ~1 s startup).
    cloudflare({ viteEnvironment: { name: "ssr" } }),
  ],
});

import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tsconfigPaths(),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
    // Builds the SSR environment into the Worker. Keep the server bundle
    // lean: no heavy top-level imports (Workers 128 MB / ~1 s startup).
    cloudflare({ viteEnvironment: { name: "ssr" } }),
  ],
});

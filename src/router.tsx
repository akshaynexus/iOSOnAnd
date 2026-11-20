import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// TanStack Start entry: the Vite plugin resolves this file automatically
// (src/router.tsx exporting getRouter). routeTree.gen.ts is generated from
// src/routes/** by @tanstack/router-plugin on dev/build.
export const getRouter = () => {
  const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
  });
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

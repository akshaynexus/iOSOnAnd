// /api-reference — the interactive API reference (Scalar), rendering
// GET /api/openapi.json (src/lib/openapi.ts).
//
// Scalar loads in the browser only, from jsDelivr at a pinned version, so it
// adds nothing to the Worker bundle. "Try it" sends requests to this origin
// (the document's server URL is the request origin); the session cookie of a
// logged-in browser goes with them, or paste a tracker token under Auth.

import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTheme } from "next-themes";

const SCALAR_VERSION = "1.82.1";
const SCALAR_SRC = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.js`;

export const Route = createFileRoute("/api-reference")({
  head: () => ({
    meta: [
      { title: "API reference: iOSOnAnd" },
      { name: "description", content: "Every iOSOnAnd tracker endpoint, its auth level, parameters and response shapes, with requests you can send." },
    ],
  }),
  component: ApiReference,
});

interface ScalarInstance {
  destroy: () => void;
}
declare global {
  interface Window {
    Scalar?: { createApiReference: (el: Element, config: Record<string, unknown>) => ScalarInstance };
  }
}

// Scalar's colours mapped onto the app's tokens (src/styles.css), which flip
// with the html.dark class; the font is the app's Geist.
const CUSTOM_CSS = `
.scalar-app, .light-mode, .dark-mode {
  --scalar-font: 'Geist Variable', sans-serif;
  --scalar-background-1: var(--background);
  --scalar-background-2: var(--muted);
  --scalar-background-3: var(--accent);
  --scalar-background-accent: color-mix(in oklch, var(--brand) 12%, transparent);
  --scalar-color-1: var(--foreground);
  --scalar-color-2: var(--muted-foreground);
  --scalar-color-3: color-mix(in oklch, var(--muted-foreground) 75%, transparent);
  --scalar-color-accent: var(--brand);
  --scalar-border-color: var(--border);
  --scalar-link-color: var(--brand);
  --scalar-button-1: var(--primary);
  --scalar-button-1-color: var(--primary-foreground);
  --scalar-button-1-hover: color-mix(in oklch, var(--primary) 85%, transparent);
  --scalar-radius: 0.375rem;
  --scalar-radius-lg: 0.5rem;
}
.scalar-app .t-doc__sidebar, .scalar-app .sidebar {
  --scalar-sidebar-background-1: var(--sidebar);
  --scalar-sidebar-color-1: var(--sidebar-foreground);
  --scalar-sidebar-border-color: var(--border);
}
/* Sit under the app's sticky top bar (h-16). */
.scalar-app { --scalar-custom-header-height: 4rem; }
`;

let loading: Promise<void> | null = null;
function loadScalar(): Promise<void> {
  if (window.Scalar) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCALAR_SRC;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error(`could not load ${SCALAR_SRC}`));
    };
    document.head.appendChild(s);
  });
  return loading;
}

function ApiReference() {
  const el = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const dark = resolvedTheme === "dark";

  useEffect(() => {
    if (!resolvedTheme) return;
    let instance: ScalarInstance | null = null;
    let cancelled = false;
    loadScalar()
      .then(() => {
        if (cancelled || !el.current || !window.Scalar) return;
        instance = window.Scalar.createApiReference(el.current, {
          url: "/api/openapi.json",
          forceDarkModeState: dark ? "dark" : "light",
          hideDarkModeToggle: true,
          withDefaultFonts: false,
          hideClientButton: false,
          showDeveloperTools: "never",
          agent: { disabled: true },
          persistAuth: true,
          defaultOpenAllTags: false,
          customCss: CUSTOM_CSS,
          metaData: { title: "iOSOnAnd API reference" },
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      instance?.destroy();
    };
  }, [resolvedTheme, dark]);

  return (
    <div className="api-reference min-h-[calc(100dvh-4rem)]">
      {error ? (
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-10">
          <h1 className="text-xl font-semibold">API reference did not load</h1>
          <p className="text-muted-foreground">
            {error}. The OpenAPI document is still at{" "}
            <a className="text-brand hover:underline" href="/api/openapi.json">
              /api/openapi.json
            </a>
            , and the endpoint list at{" "}
            <a className="text-brand hover:underline" href="/api/docs">
              /api/docs
            </a>
            .
          </p>
        </div>
      ) : null}
      <div ref={el} />
    </div>
  );
}

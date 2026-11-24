import { HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/components/auth";
import { Page } from "@/components/Page";
import { Toaster } from "@/components/ui/sonner";
import { SITE_DESCRIPTION, seo } from "@/lib/seo";
import "../styles.css";

const base = seo({ title: "iOSOnAnd: iOS on Android status", description: SITE_DESCRIPTION });

export const Route = createRootRoute({
  head: () => ({
    links: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "format-detection", content: "telephone=no" },
      ...base.meta,
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootComponent() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AuthProvider>
            <Page>
              <Outlet />
            </Page>
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p>
        <Link to="/" className="underline">
          Back to all devices
        </Link>
      </p>
    </div>
  );
}

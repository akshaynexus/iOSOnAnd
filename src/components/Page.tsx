import { forwardRef, useEffect, useRef, useState } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { Moon, Search, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth";
import { useAction } from "@/components/useAction";
import { useThemeMode } from "@/components/common";
import PillNav from "@/components/reactbits/PillNav";
import type { PillNavItem } from "@/components/reactbits/PillNav";
import { deviceMatches } from "@/lib/areas";
import { logout, type Dashboard } from "@/lib/client";
import { cn } from "@/lib/utils";

const NAV_ITEMS: PillNavItem[] = [
  { label: "Overview", href: "/" },
  { label: "Compatibility", href: "/?tab=compatibility" },
  { label: "Repos", href: "/?tab=repos" },
  { label: "Updates", href: "/?tab=updates" },
  { label: "Changelog", href: "/?tab=changelog" },
  { label: "Docs", href: "/docs" },
  { label: "API", href: "/api-reference", ariaLabel: "API reference" },
];

/**
 * PillNav's link component: maps an href onto the router. "/?tab=x" keeps the
 * current search query; "/docs/..." goes to the docs splat route.
 */
const RouterLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>(
  function RouterLink({ href, ...props }, ref) {
    const url = new URL(href, "http://local");
    if (url.pathname === "/docs" || url.pathname.startsWith("/docs/")) {
      return <Link ref={ref} to="/docs/$" params={{ _splat: url.pathname.slice(6) }} {...props} />;
    }
    if (url.pathname === "/") {
      const tab = url.searchParams.get("tab") ?? undefined;
      return (
        <Link
          ref={ref}
          to="/"
          search={(prev: Record<string, unknown>) => ({ q: typeof prev.q === "string" ? prev.q : undefined, tab: tab as never })}
          {...props}
        />
      );
    }
    return <Link ref={ref} to={url.pathname as never} {...props} />;
  },
);

/** The nav item for the current page, as PillNav's activeHref. */
function useActiveHref(): string {
  return useRouterState({
    select: (s) => {
      const p = s.location.pathname;
      if (p === "/") {
        const tab = (s.location.search as { tab?: unknown }).tab;
        return typeof tab === "string" ? `/?tab=${tab}` : "/";
      }
      if (p === "/docs" || p.startsWith("/docs/")) return "/docs";
      if (p.startsWith("/api-reference")) return "/api-reference";
      return p;
    },
  });
}

/** Two offset phone outlines: the site's mark. */
function Mark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden>
      <rect x="3.5" y="4.5" width="9" height="15" rx="2.2" />
      <path d="M14.5 6.5h2.8a2.2 2.2 0 0 1 2.2 2.2v10.6a2.2 2.2 0 0 1-2.2 2.2h-5.1a2.2 2.2 0 0 1-2.1-1.5" opacity="0.6" />
      <path d="M6.5 16.5h3" strokeLinecap="round" />
    </svg>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="rounded-full"
      aria-label={dark ? "Use light theme" : "Use dark theme"}
      title={dark ? "Use light theme" : "Use dark theme"}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}

/**
 * Global search. On the home page it filters live and keeps ?q= in the URL;
 * elsewhere Enter opens the home page with the query.
 */
function SiteSearch({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const navigate = useNavigate();
  const { pathname, urlQ, dashboard } = useRouterState({
    select: (s) => {
      const search = s.location.search as { q?: unknown };
      return {
        pathname: s.location.pathname,
        urlQ: typeof search.q === "string" ? search.q : "",
        dashboard: s.matches.find((m) => m.routeId === "/")?.loaderData as Dashboard | undefined,
      };
    },
  });
  const onHome = pathname === "/";
  const [query, setQuery] = useState(onHome ? urlQ : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setQuery(onHome ? urlQ : "");
  }, [onHome, urlQ]);

  useEffect(() => {
    if (!onHome || query === urlQ) return;
    const t = setTimeout(() => {
      void navigate({
        to: "/",
        search: (prev: Record<string, unknown>) => ({ ...prev, q: query.trim() ? query : undefined }),
        replace: true,
        resetScroll: false,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [query, urlQ, onHome, navigate]);

  // "/" focuses the search from anywhere outside a text field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const el = inputRef.current;
      if (!el || el.offsetParent === null) return;
      e.preventDefault();
      el.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function submit() {
    const q = query.trim();
    if (!q) return;
    const hits = dashboard?.devices.filter((d) => deviceMatches(d, q)) ?? [];
    if (onHome && hits.length === 1) {
      void navigate({ to: "/device/$slug", params: { slug: hits[0].slug } });
    } else if (!onHome) {
      void navigate({ to: "/", search: { q } });
    }
  }

  const id = autoFocus ? "site-search-mobile" : "site-search";
  return (
    <div className={cn("relative min-w-0", className)}>
      <label htmlFor={id} className="sr-only">
        Search devices and repos
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        id={id}
        type="search"
        value={query}
        autoFocus={autoFocus}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
          if (e.key === "Enter") submit();
        }}
        placeholder="Search"
        autoComplete="off"
        className="h-9 w-full min-w-0 rounded-full border border-input bg-background pr-10 pl-9 text-base outline-none pointer-coarse:h-11 md:text-sm pointer-coarse:text-base placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 dark:bg-input/30 [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute top-1/2 right-1 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground pointer-coarse:size-9"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden h-5 -translate-y-1/2 items-center rounded border px-1.5 font-mono text-xs text-muted-foreground lg:inline-flex">
          /
        </kbd>
      )}
    </div>
  );
}

function Account({ compact }: { compact?: boolean }) {
  const { user, loading, refresh, isAdmin } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const [onLogout, loggingOut] = useAction(async () => {
    await logout();
    await refresh();
    await router.invalidate();
    await navigate({ to: "/" });
  });
  if (loading) return <span className="inline-block h-9 w-16" aria-hidden />;
  if (user) {
    const label = user.github_login ? `@${user.github_login}` : user.display_name || user.email || "Profile";
    return (
      <div className={cn("flex items-center gap-1", compact && "flex-col items-stretch")}>
        <Button
          variant="ghost"
          size="sm"
          className={cn("max-w-40 rounded-full", compact && "max-w-none justify-start")}
          nativeButton={false}
          render={
            <Link to="/profile">
              <span className="truncate">{label}</span>
            </Link>
          }
        />
        {isAdmin ? (
          <Button
            variant="ghost"
            size="sm"
            className={cn("rounded-full", compact && "justify-start")}
            nativeButton={false}
            render={<Link to="/admin">Admin</Link>}
          />
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className={cn("rounded-full", compact ? "justify-start" : "hidden lg:inline-flex")}
          onClick={() => void onLogout()}
          disabled={loggingOut}
        >
          Log out
        </Button>
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-2", compact && "flex-col items-stretch")}>
      <Button
        variant="ghost"
        size="sm"
        className={cn("rounded-full", compact && "justify-start")}
        nativeButton={false}
        render={<Link to="/login">Log in</Link>}
      />
      <Button
        size="sm"
        className={cn("rounded-full px-4", compact && "w-full")}
        nativeButton={false}
        render={<Link to="/signup">Sign up</Link>}
      />
    </div>
  );
}

function SiteNav() {
  const activeHref = useActiveHref();
  const mode = useThemeMode();
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setSearchOpen(false), [pathname]);

  return (
    <header className="site-header sticky top-0 z-40">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
        <div className="site-nav min-w-0 flex-1">
          <PillNav
            logo={<Mark />}
            logoAlt="iOSOnAnd home"
            logoHref="/"
            items={NAV_ITEMS}
            activeHref={activeHref}
            linkComponent={RouterLink}
            theme={mode}
            size="sm"
            itemStyle="plain"
            hoverEffect="fill"
            indicator="pill"
            ariaLabel="Main"
            intro={false}
            extra={
              <div className="flex flex-col gap-1 pt-2 sm:hidden">
                <Account compact />
              </div>
            }
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <SiteSearch className="hidden w-44 md:block lg:w-52" />
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full md:hidden"
            aria-label={searchOpen ? "Close search" : "Search"}
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((o) => !o)}
          >
            {searchOpen ? <X /> : <Search />}
          </Button>
          <ThemeToggle />
          <div className="hidden sm:block">
            <Account />
          </div>
        </div>
      </div>
      {searchOpen ? (
        <div className="mx-auto max-w-6xl px-4 pb-3 md:hidden">
          <SiteSearch autoFocus />
        </div>
      ) : null}
    </header>
  );
}

/** /docs and /api-reference bring their own layout (sidebar, full width). */
const FULL_WIDTH = /^\/(docs|api-reference)(\/|$)/;

export function Page({ children }: { children: ReactNode }) {
  const full = useRouterState({ select: (s) => FULL_WIDTH.test(s.location.pathname) });
  return (
    <>
      <SiteNav />
      {full ? <main>{children}</main> : <main className="site-main mx-auto max-w-6xl pt-6">{children}</main>}
    </>
  );
}

/** Error view for a page route whose loader or render failed. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-xl font-semibold">This page failed to load</h1>
      <p className="text-muted-foreground">{error instanceof Error ? error.message : "Unknown error"}</p>
      <Button
        variant="outline"
        onClick={() => {
          reset();
          void router.invalidate();
        }}
      >
        Try again
      </Button>
    </div>
  );
}

/** Pending view while a page's loader runs on client navigation. */
export function RoutePending() {
  return (
    <p className="text-muted-foreground" role="status">
      Loading
    </p>
  );
}

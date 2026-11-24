/**
 * "Link GitHub" for signed-in users whose account has no GitHub login yet:
 * a slim bar under the header, and a link for the claim flows. Linking goes
 * through the GitHub sign-in (src/lib/githubOAuth.ts), which links GitHub to
 * the account you are signed in to and comes back to the same page. With
 * GitHub linked, the tracker matches the repos you own (claims, "Your repos").
 */
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth";
import { useGithubSignIn } from "@/components/GithubSignIn";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "iosonand.link-github.dismissed";
/** Hiding the bar lasts a week, then it asks again: most claims depend on a linked GitHub. */
const SNOOZE_MS = 7 * 24 * 3600 * 1000;

/** The GitHub sign-in URL that links GitHub to this account and returns to `redirect`. */
export function linkGithubHref(redirect: string): string {
  return `/api/auth/github/start?redirect=${encodeURIComponent(redirect || "/")}`;
}

function useHere(): string {
  return useRouterState({ select: (s) => s.location.pathname + s.location.searchStr });
}

/** "Link GitHub" as an inline text link (claim dialogs, cards). Falls back to the profile's GitHub tab when sign-in is off. */
export function LinkGithubLink({ children = "Link your GitHub account", className }: { children?: React.ReactNode; className?: string }) {
  const here = useHere();
  const enabled = useGithubSignIn();
  return (
    <a href={enabled ? linkGithubHref(here) : "/profile?tab=github"} className={className ?? "font-medium text-foreground underline underline-offset-4"}>
      {children}
    </a>
  );
}

/** The bar under the header, for signed-in users without GitHub; dismissed per browser. */
export function LinkGithubBar() {
  const { user, loading } = useAuth();
  const enabled = useGithubSignIn();
  const here = useHere();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY));
      setDismissed(Number.isFinite(at) && at > 1 && Date.now() - at < SNOOZE_MS);
    } catch {
      setDismissed(false);
    }
  }, []);
  // The profile shows its own GitHub card.
  if (loading || !user || user.github_login || !enabled || dismissed || here.startsWith("/api") || here.startsWith("/profile")) return null;
  return (
    <div className="mb-6">
      <div className="flex flex-col gap-3 rounded-[14px] border bg-card px-4 py-3 text-card-foreground sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">Link your GitHub account</span>{" "}
          <span className="text-muted-foreground">so the tracker can match the repos you own and you can claim them in one click.</span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" nativeButton={false} render={<a href={linkGithubHref(here)}>Link GitHub</a>} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide"
            onClick={() => {
              setDismissed(true);
              try {
                localStorage.setItem(DISMISS_KEY, String(Date.now()));
              } catch {
                /* not remembered */
              }
            }}
          >
            <X />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * A "Link GitHub" card for signed-in users without GitHub, where they claim
 * things (the claim dialog, a phone nobody maintains). Hidden otherwise.
 */
export function LinkGithubCallout({ className, text }: { className?: string; text?: string }) {
  const { user, loading } = useAuth();
  const enabled = useGithubSignIn();
  const here = useHere();
  if (loading || !user || user.github_login) return null;
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border bg-muted/40 px-3 py-3 sm:flex-row sm:items-center", className)}>
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">Link your GitHub account.</span>{" "}
        <span className="text-muted-foreground">{text ?? "Repos under your GitHub username are approved the moment you claim them."}</span>
      </p>
      <Button size="sm" className="shrink-0" nativeButton={false} render={<a href={enabled ? linkGithubHref(here) : "/profile?tab=github"}>Link GitHub</a>} />
    </div>
  );
}

import { PrimaryAction } from "@/components/common";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

let enabledOnce: Promise<boolean> | null = null;

/** Whether "Continue with GitHub" is set up on this tracker (GET /api/auth/github), asked once per page load. */
export function useGithubSignIn(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    enabledOnce ??= fetch("/api/auth/github")
      .then((r) => (r.ok ? (r.json() as Promise<{ enabled?: boolean }>) : { enabled: false }))
      .then((b) => !!b.enabled)
      .catch(() => false);
    let live = true;
    void enabledOnce.then((v) => live && setEnabled(v));
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}

/** A full-page link to GitHub's sign-in (src/lib/githubOAuth.ts); `redirect` is where to land after. */
export function GithubSignInButton({ redirect = "/", label = "Continue with GitHub", className }: { redirect?: string; label?: string; className?: string }) {
  // The animated primary button (a <button>), going to GitHub's sign-in on click.
  return (
    <PrimaryAction size="md" className={cn("w-full", className)} onClick={() => window.location.assign(`/api/auth/github/start?redirect=${encodeURIComponent(redirect)}`)}>
      {label}
    </PrimaryAction>
  );
}

/** What an ?error= from the GitHub sign-in means. */
export const GITHUB_ERRORS: Record<string, string> = {
  github_off: "GitHub sign-in is not set up on this tracker yet. Use email and password.",
  github_denied: "GitHub sign-in was cancelled.",
  github_state: "That sign-in link expired or was opened in another browser. Try again.",
  github_failed: "GitHub did not confirm the sign-in. Try again in a moment.",
  github_taken: "That GitHub account is linked to another tracker account. Sign in with it, or unlink it there first.",
};

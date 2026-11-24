import { useEffect, useState } from "react";
import { PrimaryAction } from "@/components/common";
import type { FormEvent } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { useAuth } from "@/components/auth";
import { useAction } from "@/components/useAction";
import { AuthCard, authLink } from "@/components/AuthCard";
import { CodeLine, siteOrigin } from "@/components/ProfileParts";
import { GITHUB_ERRORS, GithubSignInButton, useGithubSignIn } from "@/components/GithubSignIn";
import { login, signup } from "@/lib/client";

/** Only same-site paths are followed after login. */
export function safeRedirect(r: unknown): string {
  return typeof r === "string" && r.startsWith("/") && !r.startsWith("//") ? r : "/";
}

export function AuthForm({ mode, redirect, error }: { mode: "login" | "signup"; redirect: string; error?: string }) {
  const github = useGithubSignIn();
  const navigate = useNavigate();
  const router = useRouter();
  const { user, loading, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [submitForm, pending] = useAction(async () => {
    if (mode === "signup") {
      await signup({ email: email.trim(), password, display_name: displayName.trim() || undefined });
    } else {
      await login({ email: email.trim(), password });
    }
    await refresh();
    await router.invalidate();
    // A new account goes on to link GitHub (claims need it), unless it came from somewhere.
    if (mode === "signup" && redirect === "/") await navigate({ to: "/profile", search: { tab: "github" } });
    else await navigate({ href: redirect });
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submitForm();
  }

  const title = mode === "signup" ? "Sign up" : "Log in";

  const footer = (
    <>
      {mode === "signup" ? "Have an account? " : "No account? "}
      <Link
        to={mode === "signup" ? "/login" : "/signup"}
        search={redirect !== "/" ? { redirect } : {}}
        className={authLink}
      >
        {mode === "signup" ? "Log in" : "Sign up"}
      </Link>
    </>
  );

  return (
    <AuthCard title={title} footer={!loading && user ? undefined : footer}>
      {!loading && user ? (
        <p>
          You are logged in as {user.display_name || user.email}.{" "}
          <Link to="/profile" className={authLink}>
            Profile
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {error ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              {GITHUB_ERRORS[error] ?? "Sign-in failed. Try again."}
            </p>
          ) : null}
          {github ? (
            <>
              <GithubSignInButton redirect={mode === "signup" && redirect === "/" ? "/profile/keys" : redirect} />
              <p className="text-center text-xs text-muted-foreground">or with email</p>
            </>
          ) : null}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === "signup" ? (
            <Field id="display-name" label="Display name">
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="nickname"
              />
            </Field>
          ) : null}
          <Field id="email" label="Email">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </Field>
          <Field id="password" label="Password" hint={mode === "signup" ? "At least 10 characters" : undefined}>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              minLength={mode === "signup" ? 10 : undefined}
              aria-describedby={mode === "signup" ? "password-hint" : undefined}
              required
            />
          </Field>
          {mode === "login" ? (
            <Link
              to="/forgot-password"
              className="-mt-1 self-end text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot password?
            </Link>
          ) : null}
          <PrimaryAction type="submit" size="md" className="mt-2 w-full" disabled={pending}>
            {mode === "signup" ? (pending ? "Creating account" : "Sign up") : pending ? "Logging in" : "Log in"}
          </PrimaryAction>
          {mode === "signup" ? <TerminalSignup /> : null}
        </form>
        </div>
      )}
    </AuthCard>
  );
}

/** Signing up from a terminal (or by a coding agent): an email account, then GitHub linked with a secret gist. */
function TerminalSignup() {
  const [site, setSite] = useState("");
  useEffect(() => setSite(siteOrigin()), []);
  const base = site || "https://<this site>";
  return (
    <details className="rounded-lg border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">Sign up from the terminal or an agent</summary>
      <div className="flex flex-col gap-2 border-t p-3">
        <p className="text-sm text-muted-foreground">Node 18+ and the GitHub CLI logged in. The second command proves your GitHub account with a secret gist and deletes it after.</p>
        <CodeLine text={`curl -fsSLo cli.mjs ${base}/cli.mjs`} />
        <CodeLine text={`TRACKER_URL=${base} node cli.mjs login --email you@example.com --register`} />
        <CodeLine text={`TRACKER_URL=${base} node cli.mjs link --email you@example.com`} />
      </div>
    </details>
  );
}

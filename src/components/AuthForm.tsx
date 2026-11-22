import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { useAuth } from "@/components/auth";
import { useAction } from "@/components/useAction";
import { PrimaryAction } from "@/components/common";
import { login, signup } from "@/lib/client";

/** Only same-site paths are followed after login. */
export function safeRedirect(r: unknown): string {
  return typeof r === "string" && r.startsWith("/") && !r.startsWith("//") ? r : "/";
}

export function AuthForm({ mode, redirect }: { mode: "login" | "signup"; redirect: string }) {
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
    await navigate({ href: redirect });
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submitForm();
  }

  const title = mode === "signup" ? "Sign up" : "Log in";

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      {!loading && user ? (
        <p>
          You are logged in as {user.display_name || user.email}.{" "}
          <Link to="/profile" className="underline underline-offset-4">
            Profile
          </Link>
        </p>
      ) : (
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
          {mode === "signup" ? (
            <PrimaryAction type="submit" disabled={pending} size="md" className="w-full">
              {pending ? "Creating account" : "Sign up"}
            </PrimaryAction>
          ) : (
            <Button type="submit" disabled={pending}>
              {pending ? "Logging in" : "Log in"}
            </Button>
          )}
        </form>
      )}
      <p className="text-sm text-muted-foreground">
        {mode === "signup" ? "Have an account? " : "No account? "}
        <Link
          to={mode === "signup" ? "/login" : "/signup"}
          search={redirect !== "/" ? { redirect } : {}}
          className="underline underline-offset-4"
        >
          {mode === "signup" ? "Log in" : "Sign up"}
        </Link>
      </p>
    </div>
  );
}

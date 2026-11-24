import { useEffect, useState } from "react";
import { PrimaryAction } from "@/components/common";
import type { FormEvent } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { useAuth } from "@/components/auth";
import { useAction } from "@/components/useAction";
import { confirmPasswordReset } from "@/lib/client";

// The reset link is /reset-password#token=<secret>. The fragment never reaches
// the server (no logs, no Referer); this page reads it and then clears it.
import { AuthCard, authLink } from "@/components/AuthCard";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/reset-password")({
  head: () => {
    const s = seo({ title: "New password: iOSOnAnd", noindex: true });
    return { ...s, meta: [...s.meta, { name: "referrer", content: "no-referrer" }] };
  },
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const { refresh } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");

  useEffect(() => {
    const t = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    setToken(t);
    if (t) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const [submit, pending] = useAction(async () => {
    const res = await confirmPasswordReset({ token: token || "", password });
    toast.success("Password set", {
      description: res.tokens_revoked
        ? `Revoked ${res.tokens_revoked} API key${res.tokens_revoked === 1 ? "" : "s"}. Create new ones on your profile.`
        : undefined,
    });
    await refresh();
    await router.invalidate();
    await navigate({ to: "/profile" });
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  return (
    <AuthCard title="Set a new password">
      {token === null ? null : !token ? (
        <p>
          This link has no reset code.{" "}
          <Link to="/forgot-password" className={authLink}>
            Ask for a new link
          </Link>
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field id="password" label="New password" hint="At least 10 characters">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              aria-describedby="password-hint"
              required
            />
          </Field>
          <PrimaryAction type="submit" size="md" className="mt-2 w-full" disabled={pending}>
            {pending ? "Saving" : "Set password"}
          </PrimaryAction>
          <p className="text-sm text-muted-foreground">Every device is logged out and your API keys are revoked.</p>
        </form>
      )}
    </AuthCard>
  );
}

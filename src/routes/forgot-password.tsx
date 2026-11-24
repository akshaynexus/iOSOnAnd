import { useState } from "react";
import { PrimaryAction } from "@/components/common";
import type { FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { useAction } from "@/components/useAction";
import { requestPasswordReset } from "@/lib/client";
import { AuthCard, authLink } from "@/components/AuthCard";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/forgot-password")({
  head: () => seo({ title: "Reset password: iOSOnAnd", noindex: true }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const [submit, pending] = useAction(async () => {
    await requestPasswordReset(email.trim());
    setSent(true);
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  return (
    <AuthCard
      title="Reset password"
      footer={
        <Link to="/login" className={authLink}>
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <p role="status">
          If an account uses {email.trim()}, a reset link is on its way. It works once, for 30 minutes.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          <PrimaryAction type="submit" size="md" className="mt-2 w-full" disabled={pending}>
            {pending ? "Sending" : "Send reset link"}
          </PrimaryAction>
        </form>
      )}
    </AuthCard>
  );
}

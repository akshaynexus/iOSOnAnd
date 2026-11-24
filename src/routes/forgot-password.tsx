import { useState } from "react";
import type { FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { useAction } from "@/components/useAction";
import { requestPasswordReset } from "@/lib/client";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password: iOSOnAnd" }] }),
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
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
      <h1 className="text-xl font-semibold">Reset password</h1>
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
          <Button type="submit" disabled={pending}>
            {pending ? "Sending" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="text-sm text-muted-foreground">
        <Link to="/login" className="underline underline-offset-4">
          Back to log in
        </Link>
      </p>
    </div>
  );
}

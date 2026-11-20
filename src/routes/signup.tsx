import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { AuthForm } from "@/components/AuthForm";
import { errorMessage, signup } from "@/lib/client";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  return (
    <Page>
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <h1 className="text-2xl font-semibold">Sign up</h1>
        <AuthForm
          mode="signup"
          pending={pending}
          onSubmit={async ({ email, password, displayName }) => {
            setPending(true);
            try {
              await signup({ email, password, display_name: displayName || undefined });
              navigate({ to: "/" });
              window.location.reload();
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setPending(false);
            }
          }}
        />
        <p className="text-sm text-muted-foreground">
          Have an account? <Link to="/login" className="underline">Log in</Link>
        </p>
      </div>
    </Page>
  );
}

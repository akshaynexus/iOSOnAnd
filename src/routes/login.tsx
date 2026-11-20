import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { AuthForm } from "@/components/AuthForm";
import { errorMessage, login } from "@/lib/client";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  return (
    <Page>
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <h1 className="text-2xl font-semibold">Log in</h1>
        <AuthForm
          mode="login"
          pending={pending}
          onSubmit={async ({ email, password }) => {
            setPending(true);
            try {
              await login({ email, password });
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
          No account? <Link to="/signup" className="underline">Sign up</Link>
        </p>
      </div>
    </Page>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { AuthForm, safeRedirect } from "@/components/AuthForm";

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  head: () => ({ meta: [{ title: "Sign up: iOSOnAnd" }] }),
  component: SignupPage,
});

function SignupPage() {
  const { redirect } = Route.useSearch();
  return <AuthForm mode="signup" redirect={safeRedirect(redirect)} />;
}

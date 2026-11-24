import { createFileRoute } from "@tanstack/react-router";
import { AuthForm, safeRedirect } from "@/components/AuthForm";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/signup")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string; error?: string } => ({
    ...(typeof search.redirect === "string" ? { redirect: search.redirect } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  head: () => seo({ title: "Sign up: iOSOnAnd", noindex: true }),
  component: SignupPage,
});

function SignupPage() {
  const { redirect, error } = Route.useSearch();
  return <AuthForm mode="signup" redirect={safeRedirect(redirect)} error={error} />;
}

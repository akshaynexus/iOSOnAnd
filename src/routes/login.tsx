import { createFileRoute } from "@tanstack/react-router";
import { AuthForm, safeRedirect } from "@/components/AuthForm";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string; error?: string } => ({
    ...(typeof search.redirect === "string" ? { redirect: search.redirect } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  head: () => seo({ title: "Log in: iOSOnAnd", noindex: true }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect, error } = Route.useSearch();
  return <AuthForm mode="login" redirect={safeRedirect(redirect)} error={error} />;
}

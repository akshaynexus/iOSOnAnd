import { createFileRoute } from "@tanstack/react-router";
import { AuthForm, safeRedirect } from "@/components/AuthForm";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } =>
    typeof search.redirect === "string" ? { redirect: search.redirect } : {},
  head: () => ({ meta: [{ title: "Log in: iOSOnAnd" }] }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  return <AuthForm mode="login" redirect={safeRedirect(redirect)} />;
}

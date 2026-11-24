import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "@/components/auth";
import { ApiKeys } from "@/components/ApiKeys";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/profile_/keys")({
  validateSearch: (search: Record<string, unknown>): { welcome?: 1 } => (search.welcome ? { welcome: 1 } : {}),
  head: () => seo({ title: "API keys: iOSOnAnd", noindex: true }),
  component: KeysPage,
});

function KeysPage() {
  const { user, loading } = useAuth();
  const { welcome } = Route.useSearch();
  if (loading) {
    return (
      <p className="text-muted-foreground" role="status">
        Loading
      </p>
    );
  }
  if (!user) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <h1 className="text-xl font-semibold">API keys</h1>
        <p>
          <Link to="/login" search={{ redirect: "/profile/keys" }} className="underline underline-offset-4">
            Log in
          </Link>{" "}
          to manage your keys.
        </p>
      </div>
    );
  }
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Link to="/profile" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        Profile
      </Link>
      {welcome ? (
        <div role="status" className="flex flex-col gap-1 rounded-[14px] border bg-card p-4">
          <p className="font-medium">Welcome{user.github_login ? `, @${user.github_login}` : ""}</p>
          <p className="text-muted-foreground">
            Your account is bound to your GitHub login, so your own repos are approved the moment you claim them. Make a key below for the machine or agent
            that will claim repos and post updates, then give it to the CLI as TRACKER_TOKEN.
          </p>
        </div>
      ) : null}
      <ApiKeys />
    </div>
  );
}

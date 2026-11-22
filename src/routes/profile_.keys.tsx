import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useAuth } from "@/components/auth";
import { ApiKeys } from "@/components/ApiKeys";

export const Route = createFileRoute("/profile_/keys")({
  head: () => ({ meta: [{ title: "API keys: iOSOnAnd" }] }),
  component: KeysPage,
});

function KeysPage() {
  const { user, loading } = useAuth();
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
      <ApiKeys />
    </div>
  );
}

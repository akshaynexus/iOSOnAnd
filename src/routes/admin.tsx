import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/auth";
import { useAction } from "@/components/useAction";
import { Panel } from "@/components/ProfileParts";
import { Skeleton } from "@/components/motion";
import {
  listClaims,
  listRepoClaims,
  listUsers,
  reviewClaim,
  reviewRepoClaim,
  type AdminUser,
  type Claim,
  type RepoClaim,
} from "@/lib/client";
import { formatDate, relativeTime } from "@/lib/utils";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/admin")({
  validateSearch: (search: Record<string, unknown>): { tab?: "users" } => (search.tab === "users" ? { tab: "users" } : {}),
  head: () => seo({ title: "Admin: iOSOnAnd", noindex: true }),
  component: AdminPage,
});

function When({ iso }: { iso?: string | null }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} title={formatDate(iso)} suppressHydrationWarning className="text-muted-foreground">
      {relativeTime(iso)}
    </time>
  );
}

function repoClaimant(c: RepoClaim): string {
  const u = c.user;
  if (!u) return c.user_id ? `user#${c.user_id}` : "Someone";
  if (typeof u === "string") return u;
  return u.github_login ? `@${u.github_login}` : u.display_name || `user#${u.id}`;
}

/** Approve and Reject, for one claim. */
function Decide({ label, onDecide, busy }: { label: string; onDecide: (d: "approve" | "reject") => void; busy: boolean }) {
  return (
    <div className="flex shrink-0 gap-2">
      <Button size="sm" onClick={() => onDecide("approve")} disabled={busy} aria-label={`Approve ${label}`}>
        Approve
      </Button>
      <Button variant="outline" size="sm" onClick={() => onDecide("reject")} disabled={busy} aria-label={`Reject ${label}`}>
        Reject
      </Button>
    </div>
  );
}

/** Pending device claims and repo claims, each with approve and reject. */
function ClaimsQueue() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [device, setDevice] = useState<Claim[] | null>(null);
  const [repo, setRepo] = useState<RepoClaim[] | null>(null);

  const reload = useCallback(async () => {
    const [d, r] = await Promise.all([listClaims({ status: "pending" }).catch(() => ({ claims: [] })), listRepoClaims("pending").catch(() => ({ claims: [] }))]);
    setDevice(d.claims);
    setRepo(r.claims);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const [decideDevice, busyDevice] = useAction(async (c: Claim, d: "approve" | "reject") => {
    await reviewClaim(c.id, d);
    toast.success(`${d === "approve" ? "Approved" : "Rejected"}: ${c.user} on ${c.device_slug}`);
    await Promise.all([reload(), refresh(), router.invalidate()]);
  });
  const [decideRepo, busyRepo] = useAction(async (c: RepoClaim, d: "approve" | "reject") => {
    await reviewRepoClaim(c.id, d);
    toast.success(`${d === "approve" ? "Approved" : "Rejected"}: ${repoClaimant(c)} on ${c.repo}`);
    await Promise.all([reload(), refresh(), router.invalidate()]);
  });

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title={`Device claims${device ? ` (${device.length})` : ""}`}
        description="Someone asks to maintain a phone. Approving makes them its maintainer: they can set its statuses and post updates."
      >
        {device === null ? (
          <Skeleton className="h-16" label="Loading device claims" />
        ) : device.length === 0 ? (
          <p className="text-muted-foreground">No pending device claims.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {device.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium">{c.user}</span> on{" "}
                    <Link to="/device/$slug" params={{ slug: c.device_slug }} className="font-medium underline-offset-4 hover:underline">
                      {c.device_slug}
                    </Link>{" "}
                    <When iso={c.updated} />
                  </p>
                  {c.note ? <p className="mt-1 break-words text-muted-foreground">{c.note}</p> : null}
                </div>
                <Decide label={`${c.user} on ${c.device_slug}`} busy={busyDevice} onDecide={(d) => void decideDevice(c, d)} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title={`Repo claims${repo ? ` (${repo.length})` : ""}`}
        description="Pending repo claims are organization repos waiting for their proof file. Approving skips the file: do it only when you know the claimant is in that organization."
      >
        {repo === null ? (
          <Skeleton className="h-16" label="Loading repo claims" />
        ) : repo.length === 0 ? (
          <p className="text-muted-foreground">No pending repo claims.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {repo.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="break-words">
                    <span className="font-medium">{repoClaimant(c)}</span> on{" "}
                    <a href={`https://github.com/${c.repo}`} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-4 hover:underline">
                      {c.repo}
                    </a>
                    {c.device_slug ? <span className="text-muted-foreground"> for {c.device_slug}</span> : null} <When iso={c.created} />
                  </p>
                  {c.note ? <p className="mt-1 break-words text-muted-foreground">{c.note}</p> : null}
                </div>
                <Decide label={`${repoClaimant(c)} on ${c.repo}`} busy={busyRepo} onDecide={(d) => void decideRepo(c, d)} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Every account: who it is on GitHub and what it maintains. */
function Accounts() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  useEffect(() => {
    listUsers().then(
      (r) => setUsers(r.users),
      () => setUsers([]),
    );
  }, []);
  return (
    <Panel title={`Accounts${users ? ` (${users.length})` : ""}`}>
      {users === null ? (
        <Skeleton className="h-24" label="Loading accounts" />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {users.map((u) => (
            <li key={u.id} className="flex flex-col gap-1 px-4 py-3">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{u.display_name || `user#${u.id}`}</span>
                {u.github_login ? (
                  <a href={`https://github.com/${u.github_login}`} target="_blank" rel="noopener noreferrer" className="underline-offset-4 hover:underline">
                    @{u.github_login}
                  </a>
                ) : (
                  <span className="text-muted-foreground">GitHub not linked</span>
                )}
                {u.is_admin ? <span className="text-muted-foreground">admin</span> : null}
                <span className="text-muted-foreground">
                  #{u.id}, joined <When iso={u.created} />
                </span>
              </p>
              {u.email ? <p className="break-all text-muted-foreground">{u.email}</p> : null}
              {u.maintains.length || u.maintains_repos.length ? (
                <p className="break-words text-muted-foreground">
                  Maintains {[...u.maintains_repos, ...u.maintains].join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AdminPage() {
  const { user, loading, isAdmin } = useAuth();
  const { tab = "claims" } = Route.useSearch() as { tab?: "users" | "claims" };
  const navigate = useNavigate({ from: "/admin" });

  if (loading) return <Skeleton className="h-40 max-w-4xl" label="Loading" />;
  if (!user || !isAdmin) {
    return (
      <div className="flex max-w-md flex-col gap-3">
        <h1 className="text-xl font-semibold">Admins only</h1>
        <p className="text-muted-foreground">
          {user ? "This account is not an admin." : "Log in with an admin account."}{" "}
          <Link to={user ? "/profile" : "/login"} search={user ? undefined : { redirect: "/admin" }} className="text-foreground underline underline-offset-4">
            {user ? "Back to your profile" : "Log in"}
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
      <Tabs value={tab} onValueChange={(v) => void navigate({ search: v === "users" ? { tab: "users" } : {}, replace: true })}>
        <TabsList>
          <TabsTrigger value="claims">Claims</TabsTrigger>
          <TabsTrigger value="users">Accounts</TabsTrigger>
        </TabsList>
        <TabsContent value="claims" className="pt-2">
          <ClaimsQueue />
        </TabsContent>
        <TabsContent value="users" className="pt-2">
          <Accounts />
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { useAuth } from "@/components/auth";
import { ClaimBadge } from "@/components/StatusBadge";
import { toastError, useAction } from "@/components/useAction";
import {
  isOwnClaim,
  ghChallenge,
  ghLink,
  listClaims,
  listRepoClaims,
  reviewClaim,
  reviewRepoClaim,
  unlinkGithub,
  withdrawClaim,
  ApiRequestError,
  type Claim,
  type RepoClaim,
} from "@/lib/client";
import { ClaimNextStep } from "@/components/RepoClaim";
import { Skeleton } from "@/components/motion";
import { relativeTime } from "@/lib/utils";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profile: iOSOnAnd" }] }),
  component: ProfilePage,
});

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Copy failed", { description: "Select the text and copy it by hand." });
  }
}

function GithubSection() {
  const { user, refresh } = useAuth();
  const [login, setLogin] = useState("");
  const [nonce, setNonce] = useState("");
  const [gistUrl, setGistUrl] = useState("");

  const [start, starting] = useAction(async () => {
    const res = await ghChallenge(login.trim());
    setNonce(res.nonce);
  });
  const [link, linking] = useAction(async () => {
    await ghLink(gistUrl.trim(), nonce);
    toast.success("GitHub linked");
    setNonce("");
    setGistUrl("");
    await refresh();
  });
  const [unlink, unlinking] = useAction(async () => {
    await unlinkGithub();
    toast.success("GitHub unlinked");
    await refresh();
  });

  if (!user) return null;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">GitHub</h2>
      {user.github_login ? (
        <div className="flex flex-wrap items-center gap-2">
          <p>
            Linked as{" "}
            <a
              href={`https://github.com/${user.github_login}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-4"
            >
              @{user.github_login}
            </a>
          </p>
          <Button variant="outline" size="sm" onClick={() => void unlink()} disabled={unlinking}>
            Unlink
          </Button>
        </div>
      ) : !nonce ? (
        <form
          className="flex max-w-xl flex-col gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void start();
          }}
        >
          <p className="text-muted-foreground">Not linked.</p>
          <Field id="gh-login" label="GitHub username">
            <Input
              id="gh-login"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              required
            />
          </Field>
          <Button type="submit" size="sm" disabled={starting} className="self-start">
            {starting ? "Getting code" : "Get link code"}
          </Button>
        </form>
      ) : (
        <form
          className="flex max-w-xl flex-col gap-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void link();
          }}
        >
          <p>
            Create a secret gist on{" "}
            <a
              href="https://gist.github.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              gist.github.com
            </a>{" "}
            that contains this code, then paste the gist URL. The code expires in 10 minutes.
          </p>
          <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted py-1 pr-1 pl-3">
            <code className="min-w-0 flex-1 font-mono text-sm break-all">{nonce}</code>
            <Button type="button" variant="ghost" size="sm" onClick={() => void copy(nonce)}>
              Copy
            </Button>
          </div>
          <Field id="gist-url" label="Gist URL">
            <Input
              id="gist-url"
              type="url"
              value={gistUrl}
              onChange={(e) => setGistUrl(e.target.value)}
              placeholder="https://gist.github.com/you/abc123"
              required
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={linking}>
              {linking ? "Linking" : "Link GitHub"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNonce("")} disabled={linking}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function KeysLink() {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">API keys</h2>
      <p className="text-muted-foreground">
        The CLI and scripts sign in with a key.{" "}
        <Link to="/profile/keys" className="text-foreground underline underline-offset-4">
          Manage keys
        </Link>
      </p>
    </section>
  );
}

function repoClaimUser(c: RepoClaim): string {
  const u = c.user;
  if (!u) return c.user_id ? `user#${c.user_id}` : "Someone";
  if (typeof u === "string") return u;
  return u.github_login ? `@${u.github_login}` : u.display_name || `user#${u.id}`;
}

/** Repo claims: the user's own (with the proof step), and for admins the queue. */
function RepoClaimsSection() {
  const router = useRouter();
  const { user, isAdmin, refresh } = useAuth();
  const [claims, setClaims] = useState<RepoClaim[] | null>(null);
  const [missing, setMissing] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await listRepoClaims();
      setClaims(Array.isArray(res.claims) ? res.claims : []);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) setMissing(true);
      else toastError(err);
      setClaims([]);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const [review, reviewing] = useAction(async (id: number, decision: "approve" | "reject") => {
    const res = await reviewRepoClaim(id, decision);
    toast.success(`Repo claim ${decision === "approve" ? "approved" : "rejected"}`, { description: res.claim?.repo });
    await Promise.all([reload(), router.invalidate(), refresh()]);
  });

  if (!user || missing) return null;
  const mine = (claims ?? []).filter((c) => c.user_id === user.id || (typeof c.user === "object" && c.user?.id === user.id));
  const pending = (claims ?? []).filter((c) => c.status === "pending");

  return (
    <>
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">My repo claims</h2>
        {claims === null ? (
          <Skeleton className="h-16" label="Loading repo claims" />
        ) : mine.length === 0 ? (
          <p className="text-muted-foreground">
            None yet. Use "This is mine" on the{" "}
            <Link to="/" search={{ tab: "repos" }} className="underline underline-offset-4">
              Repos
            </Link>{" "}
            tab.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {mine.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <ClaimBadge status={(c.status === "expired" ? "rejected" : c.status) as "pending" | "approved" | "rejected"} />
                  <span className="font-medium">{c.repo}</span>
                  {c.device_slug ? <span className="text-muted-foreground">for {c.device_slug}</span> : null}
                  {c.status === "expired" ? <span className="text-muted-foreground">expired</span> : null}
                </div>
                {c.status === "pending" && c.nonce ? <ClaimNextStep claim={c} onDone={() => void reload()} /> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isAdmin ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Repo claims to review</h2>
          {claims === null ? null : pending.length === 0 ? (
            <p className="text-muted-foreground">No pending repo claims.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {pending.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{repoClaimUser(c)}</span>
                    <span>claims</span>
                    <a
                      href={`https://github.com/${c.repo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline underline-offset-4"
                    >
                      {c.repo}
                    </a>
                    {c.device_slug ? (
                      <span className="text-muted-foreground">
                        for{" "}
                        <Link to="/device/$slug" params={{ slug: c.device_slug }} className="underline underline-offset-4">
                          {c.device_slug}
                        </Link>
                      </span>
                    ) : null}
                    {c.expires ? (
                      <span className="text-xs text-muted-foreground">
                        expires{" "}
                        <time dateTime={c.expires} suppressHydrationWarning>
                          {relativeTime(c.expires)}
                        </time>
                      </span>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void review(c.id, "approve")} disabled={reviewing} aria-label={`Approve ${c.repo}`}>
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void review(c.id, "reject")}
                      disabled={reviewing}
                      aria-label={`Reject ${c.repo}`}
                    >
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}

function ClaimsSection() {
  const router = useRouter();
  const { user, isAdmin, refresh } = useAuth();
  const [claims, setClaims] = useState<Claim[] | null>(null);

  const reload = useCallback(async () => {
    try {
      setClaims((await listClaims()).claims);
    } catch (err) {
      toastError(err);
      setClaims([]);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const [review, reviewing] = useAction(async (id: number, decision: "approve" | "reject") => {
    const res = await reviewClaim(id, decision);
    toast.success(`Claim ${decision === "approve" ? "approved" : "rejected"}`, {
      description: `${res.claim.user} on ${res.claim.device_slug}`,
    });
    await Promise.all([reload(), router.invalidate(), refresh()]);
  });
  const [withdraw, withdrawing] = useAction(async (id: number) => {
    await withdrawClaim(id);
    toast.success("Claim withdrawn");
    await Promise.all([reload(), router.invalidate()]);
  });

  if (!user) return null;
  const mine = (claims ?? []).filter((c) => isOwnClaim(c, user));
  const pending = (claims ?? []).filter((c) => c.status === "pending");

  return (
    <>
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">My claims</h2>
        {claims === null ? (
          <p className="text-muted-foreground" role="status">
            Loading claims
          </p>
        ) : mine.length === 0 ? (
          <p className="text-muted-foreground">
            No claims yet. Open a{" "}
            <Link to="/" className="underline underline-offset-4">
              device
            </Link>{" "}
            to claim it.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {mine.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
                <ClaimBadge status={c.status} />
                <Link
                  to="/device/$slug"
                  params={{ slug: c.device_slug }}
                  className="font-medium underline underline-offset-4"
                >
                  {c.device_slug}
                </Link>
                {c.note ? <span className="min-w-0 break-words text-muted-foreground">{c.note}</span> : null}
                {c.status === "pending" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    onClick={() => void withdraw(c.id)}
                    disabled={withdrawing}
                  >
                    Withdraw
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isAdmin ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">Claims to review</h2>
          {claims === null ? null : pending.length === 0 ? (
            <p className="text-muted-foreground">No pending claims.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {pending.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <span className="font-medium">{c.user}</span>
                    <span>on</span>
                    <Link
                      to="/device/$slug"
                      params={{ slug: c.device_slug }}
                      className="font-medium underline underline-offset-4"
                    >
                      {c.device_slug}
                    </Link>
                    {c.note ? <span className="min-w-0 break-words text-muted-foreground">{c.note}</span> : null}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => void review(c.id, "approve")}
                      disabled={reviewing}
                      aria-label={`Approve ${c.user} on ${c.device_slug}`}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void review(c.id, "reject")}
                      disabled={reviewing}
                      aria-label={`Reject ${c.user} on ${c.device_slug}`}
                    >
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}

function ProfilePage() {
  const { user, loading, maintains, isAdmin } = useAuth();

  if (loading) {
    return (
      <p className="text-muted-foreground" role="status">
        Loading profile
      </p>
    );
  }

  if (!user) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <h1 className="text-xl font-semibold">Profile</h1>
        <p>
          <Link to="/login" search={{ redirect: "/profile" }} className="underline underline-offset-4">
            Log in
          </Link>{" "}
          to see your profile.
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-12">
      <section className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{user.display_name || "Profile"}</h1>
        {user.email ? <p className="text-muted-foreground">{user.email}</p> : null}
        {isAdmin ? <p>Admin</p> : null}
        {maintains.length > 0 ? (
          <p>
            Maintains{" "}
            {maintains.map((slug, i) => (
              <span key={slug}>
                {i > 0 ? ", " : null}
                <Link to="/device/$slug" params={{ slug }} className="underline underline-offset-4">
                  {slug}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
      </section>
      <GithubSection />
      <KeysLink />
      <ClaimsSection />
      <RepoClaimsSection />
    </div>
  );
}

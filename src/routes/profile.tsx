import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/Field";
import { useAuth } from "@/components/auth";
import { ClaimBadge } from "@/components/StatusBadge";
import { toastError, useAction } from "@/components/useAction";
import {
  addRepoMaintainer,
  addRepoPhone,
  changePassword,
  getForkByRepo,
  listDeviceNames,
  isOwnClaim,
  ghChallenge,
  ghLink,
  listClaims,
  listRepoClaims,
  reviewRepoClaim,
  unlinkGithub,
  withdrawClaim,
  ApiRequestError,
  type Claim,
  type Fork,
  type RepoClaim,
} from "@/lib/client";
import { ClaimNextStep, ClaimRepoDialog, TrackerSupportBox } from "@/components/RepoClaim";
import { CopyButton, PrimaryAction } from "@/components/common";
import { CodeLine, Panel, Steps, siteOrigin } from "@/components/ProfileParts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GITHUB_ERRORS, GithubSignInButton, useGithubSignIn } from "@/components/GithubSignIn";
import { Skeleton } from "@/components/motion";
import { AdminPanel } from "@/components/AdminPanel";
import { relativeTime } from "@/lib/utils";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/profile")({
  validateSearch: (search: Record<string, unknown>): { tab?: "github" | "claims" | "security" | "admin"; error?: string } => ({
    ...(search.tab === "github" || search.tab === "claims" || search.tab === "security" || search.tab === "admin" ? { tab: search.tab } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  }),
  head: () => seo({ title: "Profile: iOSOnAnd", noindex: true }),
  component: ProfilePage,
});

function GithubSection({ linkError }: { linkError?: string }) {
  const { user, refresh } = useAuth();
  const githubOAuth = useGithubSignIn();
  const [method, setMethod] = useState<"browser" | "cli">("browser");
  const [login, setLogin] = useState("");
  const [nonce, setNonce] = useState("");
  const [gistUrl, setGistUrl] = useState("");
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [site, setSite] = useState("");
  useEffect(() => setSite(siteOrigin()), []);

  const [start, starting] = useAction(async () => {
    const res = await ghChallenge(login.trim().replace(/^@/, ""));
    setNonce(res.nonce);
  });
  const [link, linking] = useAction(async () => {
    await ghLink(gistUrl.trim(), nonce);
    toast.success("GitHub linked", { description: "Repos under your GitHub account are approved at once when you claim them." });
    setNonce("");
    setGistUrl("");
    await refresh();
  });
  const [unlink, unlinking] = useAction(async () => {
    await unlinkGithub();
    toast.success("GitHub unlinked");
    setConfirmUnlink(false);
    await refresh();
  });

  if (!user) return null;

  if (user.github_login) {
    return (
      <Panel title="GitHub">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <img
            src={`https://avatars.githubusercontent.com/${encodeURIComponent(user.github_login)}?s=96`}
            alt=""
            width={48}
            height={48}
            className="size-12 rounded-full border bg-muted"
          />
          <div className="min-w-0 flex-1">
            <a
              href={`https://github.com/${user.github_login}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline-offset-4 hover:underline"
            >
              @{user.github_login}
            </a>
            <p className="text-sm text-muted-foreground">Your repos under @{user.github_login} are approved at once when you claim them.</p>
          </div>
          {confirmUnlink ? (
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" onClick={() => void unlink()} disabled={unlinking}>
                {unlinking ? "Unlinking" : "Unlink"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmUnlink(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirmUnlink(true)}>
              Unlink
            </Button>
          )}
        </div>
        {confirmUnlink ? (
          <p className="text-sm text-muted-foreground" role="status">
            Your repos stay claimed, but new claims need a linked account.
          </p>
        ) : null}
      </Panel>
    );
  }

  const oneClick = githubOAuth ? (
    <div className="flex flex-col gap-2">
      <GithubSignInButton redirect="/profile?tab=github" label="Link with GitHub" className="sm:w-fit" />
      <p className="text-sm text-muted-foreground">One click: GitHub confirms the account and nothing is stored but your login. Or prove it with a secret gist:</p>
    </div>
  ) : null;

  const cliSteps = [
    `curl -fsSLo cli.mjs ${site || "https://<this site>"}/cli.mjs`,
    `TRACKER_URL=${site || "https://<this site>"} node cli.mjs link --email ${user.email ?? "you@example.com"}`,
  ];
  const agentPrompt = [
    `Link my GitHub account to my iOSOnAnd account (${user.email ?? "my email"}) on ${site || "the tracker"}.`,
    "The GitHub CLI (gh) is logged in as me. Run:",
    ...cliSteps.map((c) => `  ${c}`),
    "It asks for my tracker password: let me type it. It proves the GitHub account with a secret gist and deletes the gist after.",
    "Then run `node cli.mjs whoami` and show me the login.",
  ].join("\n");

  return (
    <Panel
      title="Link your GitHub account"
      description="Claims are checked against the repo's GitHub owner, so link the account your ports live under."
    >
      {linkError ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {GITHUB_ERRORS[linkError] ?? "Linking failed. Try again."}
        </p>
      ) : null}
      {oneClick}
      <div role="tablist" aria-label="How to link" className="inline-flex w-fit rounded-full bg-muted p-1">
        {(
          [
            ["browser", "In the browser"],
            ["cli", "With the CLI or an agent"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={method === k}
            onClick={() => setMethod(k)}
            className={
              "rounded-full px-3 py-1.5 text-sm font-medium transition-colors pointer-coarse:py-2.5 " +
              (method === k ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {method === "browser" ? (
        <Steps
          current={nonce ? 1 : 0}
          steps={[
            {
              title: "Your GitHub username",
              body: (
                <form
                  className="flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void start();
                  }}
                >
                  <label htmlFor="gh-login" className="sr-only">
                    GitHub username
                  </label>
                  <Input
                    id="gh-login"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    placeholder="octocat"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    className="sm:max-w-64"
                  />
                  <PrimaryAction type="submit" disabled={starting}>
                    {starting ? "Getting code" : "Get code"}
                  </PrimaryAction>
                </form>
              ),
            },
            {
              title: "Put the code in a secret gist, then paste its link",
              body: (
                <form
                  className="flex flex-col gap-3"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void link();
                  }}
                >
                  <CodeLine text={nonce} label="Copy code" />
                  <p className="text-sm text-muted-foreground">
                    On gist.github.com, paste the code as the file's content and choose <span className="font-medium text-foreground">Create secret gist</span>. The code works for 10 minutes; delete the gist after linking.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start"
                    nativeButton={false}
                    render={
                      <a href="https://gist.github.com/" target="_blank" rel="noopener noreferrer">
                        Open gist.github.com
                      </a>
                    }
                  />
                  <Field id="gist-url" label="Gist link">
                    <Input
                      id="gist-url"
                      type="url"
                      value={gistUrl}
                      onChange={(e) => setGistUrl(e.target.value)}
                      placeholder="https://gist.github.com/octocat/abc123"
                      required
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <PrimaryAction type="submit" disabled={linking}>
                      {linking ? "Linking" : "Link GitHub"}
                    </PrimaryAction>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setNonce("")} disabled={linking}>
                      Start over
                    </Button>
                  </div>
                </form>
              ),
            },
          ]}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Needs Node 18+ and the GitHub CLI logged in (<code className="font-mono text-xs">gh auth login</code>). The CLI creates the secret gist, proves the account and deletes the gist again.
          </p>
          <div className="flex flex-col gap-2">
            {cliSteps.map((c) => (
              <CodeLine key={c} text={c} />
            ))}
          </div>
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">Ask your coding agent to do it</summary>
            <div className="flex flex-col gap-2 border-t p-3">
              <pre suppressHydrationWarning className="max-h-56 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {agentPrompt}
              </pre>
              <CopyButton text={agentPrompt} label="Copy prompt" toastText="Prompt copied" className="self-start" />
            </div>
          </details>
          <p className="text-sm text-muted-foreground">
            Then <code className="font-mono text-xs">node cli.mjs whoami</code> shows the linked login, and this page shows it after a reload.
          </p>
        </div>
      )}
    </Panel>
  );
}

function PasswordSection() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [revokeKeys, setRevokeKeys] = useState(false);

  const [save, saving] = useAction(async () => {
    const res = await changePassword({ current_password: current, new_password: next, revoke_tokens: revokeKeys });
    setCurrent("");
    setNext("");
    setRevokeKeys(false);
    const ended = res.sessions_ended ? ` Logged out ${res.sessions_ended} other session${res.sessions_ended === 1 ? "" : "s"}.` : "";
    const keys = res.tokens_revoked ? ` Revoked ${res.tokens_revoked} key${res.tokens_revoked === 1 ? "" : "s"}.` : "";
    toast.success("Password changed", { description: (ended + keys).trim() || undefined });
  });

  if (!user?.email) return null;
  return (
    <Panel title="Password">
      <form
        className="flex max-w-sm flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field id="current-password" label="Current password">
          <Input
            id="current-password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Field id="new-password" label="New password" hint="At least 10 characters">
          <Input
            id="new-password"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={10}
            aria-describedby="new-password-hint"
            required
          />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={revokeKeys} onChange={(e) => setRevokeKeys(e.target.checked)} className="size-4" />
          Also revoke my API keys
        </label>
        <Button type="submit" size="sm" disabled={saving} className="self-start">
          {saving ? "Saving" : "Change password"}
        </Button>
        <p className="text-sm text-muted-foreground">Other devices are logged out.</p>
      </form>
    </Panel>
  );
}

function KeysPanel() {
  return (
    <Panel
      title="API keys"
      description="The CLI and your agents sign in with a key. Give each one only the scopes it needs."
      actions={
        <Button variant="outline" size="sm" nativeButton={false} render={<Link to="/profile/keys">Manage keys</Link>} />
      }
    >
      {null}
    </Panel>
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
  const isMine = (c: RepoClaim) => c.user_id === user.id || (typeof c.user === "object" && c.user?.id === user.id);
  const mine = (claims ?? []).filter(isMine);
  // Others' pending claims on your repos. An admin gets every one, and reviews them in the Admin tab.
  const pending = isAdmin ? [] : (claims ?? []).filter((c) => c.status === "pending" && !isMine(c));

  return (
    <>
      <Panel title="My repo claims">
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
      </Panel>

      {pending.length ? (
        <Panel title="Repo claims to review" description="People working on your repos who asked to join you as maintainers.">
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
        </Panel>
      ) : null}
    </>
  );
}

function ClaimsSection() {
  const router = useRouter();
  const { user } = useAuth();
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

  const [withdraw, withdrawing] = useAction(async (id: number) => {
    await withdrawClaim(id);
    toast.success("Claim withdrawn");
    await Promise.all([reload(), router.invalidate()]);
  });

  if (!user) return null;
  const mine = (claims ?? []).filter((c) => isOwnClaim(c, user));

  return (
    <>
      <Panel title="My claims">
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
      </Panel>

    </>
  );
}

/** A repo's maintainers, and adding a collaborator by GitHub login (any maintainer can). */
function RepoMaintainers({ fork, onChange }: { fork: Fork; onChange: () => void }) {
  const { user } = useAuth();
  const [login, setLogin] = useState("");
  const [add, adding] = useAction(async () => {
    const clean = login.trim().replace(/^@/, "");
    if (!clean) return;
    await addRepoMaintainer(fork.id, clean);
    toast.success(`@${clean} maintains ${fork.repo} now`);
    setLogin("");
    onChange();
  });
  const others = (fork.maintainers ?? []).filter((m) => m.id !== user?.id);
  const inputId = `add-maintainer-${fork.id}`;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground">
        {others.length
          ? `With ${others.map((m) => (m.github_login ? `@${m.github_login}` : m.display_name)).join(", ")}`
          : "Only you maintain it."}
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Field id={inputId} label="Add a maintainer" hint="Their GitHub login; they sign in with GitHub first" className="flex-1">
          <Input id={inputId} value={login} onChange={(e) => setLogin(e.target.value)} placeholder="octocat" autoCapitalize="none" spellCheck={false} />
        </Field>
        <Button type="submit" variant="outline" disabled={adding || !login.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}

/**
 * The repos you maintain and their phones. Adding a phone to your repo makes
 * you its maintainer too (at once when nobody maintains it, else an admin
 * decides), so one repo claim covers every phone the repo runs on.
 */
function MyReposSection() {
  const router = useRouter();
  const { maintainsRepos, refresh } = useAuth();
  const [forks, setForks] = useState<Fork[] | null>(null);
  const [phones, setPhones] = useState<Array<{ slug: string; name: string }>>([]);
  const [pick, setPick] = useState<Record<number, string>>({});
  const key = maintainsRepos.join(",");

  const reload = useCallback(async () => {
    const rows = await Promise.all(maintainsRepos.map((r) => getForkByRepo(r).catch(() => null)));
    setForks(rows.filter((f): f is Fork => !!f));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!maintainsRepos.length) return;
    void reload();
    listDeviceNames().then(setPhones, () => setPhones([]));
  }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const [add, adding] = useAction(async (fork: Fork) => {
    const slug = pick[fork.id];
    if (!slug) return;
    const res = await addRepoPhone(fork.id, slug);
    const name = phones.find((p) => p.slug === slug)?.name ?? slug;
    if (res.device_claim?.status === "pending") {
      toast.success(`${name} added to ${fork.repo}`, { description: "Another user maintains this phone, so an admin reviews your claim on it." });
    } else {
      toast.success(`${name} added to ${fork.repo}`, { description: "You maintain it now." });
    }
    setPick((p) => ({ ...p, [fork.id]: "" }));
    await Promise.all([reload(), refresh(), router.invalidate()]);
  });

  if (!maintainsRepos.length) return null;
  return (
    <Panel title="My repos">
      {forks === null ? (
        <Skeleton className="h-16" label="Loading your repos" />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {forks.map((f) => {
            const listed = new Set([f.device_slug, ...(f.supports ?? []).map((s) => s.device_slug)].filter(Boolean) as string[]);
            const options = phones.filter((p) => !listed.has(p.slug));
            const selectId = `add-phone-${f.id}`;
            return (
              <li key={f.id} className="flex flex-col gap-3 px-4 py-3 text-sm">
                <a href={`https://github.com/${f.repo}`} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-4 hover:underline">
                  {f.repo}
                </a>
                <p className="text-muted-foreground">
                  {listed.size
                    ? [...listed].map((slug, i) => (
                        <span key={slug}>
                          {i > 0 ? ", " : null}
                          <Link to="/device/$slug" params={{ slug }} className="text-foreground underline-offset-4 hover:underline">
                            {phones.find((p) => p.slug === slug)?.name ?? slug}
                          </Link>
                        </span>
                      ))
                    : "No phones yet"}
                </p>
                <RepoMaintainers fork={f} onChange={() => void reload()} />
                <TrackerSupportBox repo={f.repo} device={f.device_slug ?? [...listed][0]} />
                <form
                  className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void add(f);
                  }}
                >
                  <Field id={selectId} label="Add a phone" className="flex-1">
                    <NativeSelect id={selectId} value={pick[f.id] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [f.id]: e.target.value }))}>
                      <option value="">Choose a phone</option>
                      {options.map((p) => (
                        <option key={p.slug} value={p.slug}>
                          {p.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Button type="submit" variant="outline" disabled={adding || !pick[f.id]}>
                    Add
                  </Button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const TABS = ["overview", "github", "claims", "security", "admin"] as const;
type Tab = (typeof TABS)[number];

/** Name, email, GitHub and what you maintain, with the main actions. */
function ProfileHeader({ onTab }: { onTab: (t: Tab) => void }) {
  const { user, maintains, maintainsRepos, isAdmin } = useAuth();
  const [adding, setAdding] = useState(false);
  if (!user) return null;
  const name = user.display_name || user.github_login || user.email || "Profile";
  return (
    <div className="flex flex-col gap-5 rounded-[14px] border bg-card p-4 text-card-foreground sm:p-6">
      <div className="flex min-w-0 items-center gap-4">
        {user.github_login ? (
          <img
            src={`https://avatars.githubusercontent.com/${encodeURIComponent(user.github_login)}?s=128`}
            alt=""
            width={64}
            height={64}
            className="size-14 shrink-0 rounded-full border bg-muted sm:size-16"
          />
        ) : (
          <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-full border bg-muted text-xl font-semibold sm:size-16">
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{name}</h1>
          <p className="truncate text-sm text-muted-foreground">
            {[user.email, user.github_login ? `@${user.github_login}` : null, isAdmin ? "admin" : null].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {(
          [
            ["Phones you maintain", maintains.length],
            ["Repos you maintain", maintainsRepos.length],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="rounded-lg border px-3 py-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <PrimaryAction onClick={() => setAdding(true)}>Add your repo</PrimaryAction>
        {user.github_login ? null : (
          <Button variant="outline" onClick={() => onTab("github")}>
            Link GitHub
          </Button>
        )}
      </div>
      {adding ? <ClaimRepoDialog open={adding} onOpenChange={setAdding} devices={[]} /> : null}
    </div>
  );
}

/** The phones you maintain, as links. */
function MaintainedPhones() {
  const { maintains } = useAuth();
  if (!maintains.length) return null;
  return (
    <Panel title="Phones you maintain">
      <ul className="flex flex-wrap gap-2">
        {maintains.map((slug) => (
          <li key={slug}>
            <Link
              to="/device/$slug"
              params={{ slug }}
              className="inline-flex h-8 items-center rounded-full border px-3 text-sm hover:bg-muted pointer-coarse:h-10"
            >
              {slug}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ProfilePage() {
  const { user, loading, maintains, maintainsRepos, isAdmin } = useAuth();
  const { tab: asked = "overview", error } = Route.useSearch();
  // The Admin tab exists for admins only; anyone else lands on the overview.
  const tab: Tab = asked === "admin" && !isAdmin ? "overview" : asked;
  const navigate = useNavigate({ from: "/profile" });
  const setTab = (t: Tab) => void navigate({ search: t === "overview" ? {} : { tab: t }, replace: true, resetScroll: false });

  if (loading) {
    return <Skeleton className="h-40 max-w-4xl" label="Loading profile" />;
  }

  if (!user) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <h1 className="text-xl font-semibold">Profile</h1>
        <p>
          <Link to="/login" search={{ redirect: asked === "admin" ? "/profile?tab=admin" : "/profile" }} className="underline underline-offset-4">
            Log in
          </Link>{" "}
          to see your profile.
        </p>
      </div>
    );
  }

  const empty = !maintains.length && !maintainsRepos.length;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <ProfileHeader onTab={setTab} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="github">GitHub</TabsTrigger>
            <TabsTrigger value="claims">Claims</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            {isAdmin ? <TabsTrigger value="admin">Admin</TabsTrigger> : null}
          </TabsList>
        </div>
        <TabsContent value="overview" className="flex flex-col gap-6 pt-2">
          {user.github_login ? null : (
            <div className="flex flex-col gap-3 rounded-[14px] border p-4 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1">Link your GitHub account so your repos can be claimed and approved at once.</p>
              <Button variant="outline" onClick={() => setTab("github")}>
                Link GitHub
              </Button>
            </div>
          )}
          <MyReposSection />
          <MaintainedPhones />
          {empty ? (
            <Panel title="Nothing to maintain yet">
              <p className="text-muted-foreground">
                Claim your port's repo with "Add your repo" above. A repo covers every phone it runs on, and a phone we don't list yet can be added with it.
              </p>
            </Panel>
          ) : null}
        </TabsContent>
        <TabsContent value="github" className="flex flex-col gap-6 pt-2">
          <GithubSection linkError={error} />
        </TabsContent>
        <TabsContent value="claims" className="flex flex-col gap-6 pt-2">
          <RepoClaimsSection />
          <ClaimsSection />
        </TabsContent>
        <TabsContent value="security" className="flex flex-col gap-6 pt-2">
          <PasswordSection />
          <KeysPanel />
        </TabsContent>
        {isAdmin ? (
          <TabsContent value="admin" className="pt-2">
            <AdminPanel />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

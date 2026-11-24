// The admin tab of /profile: pending device claims and repo claims with
// Approve and Reject, and every account. Admins only (the API checks too).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/components/auth";
import { PrimaryAction } from "@/components/common";
import { CountUp, Skeleton } from "@/components/motion";
import { Panel } from "@/components/ProfileParts";
import { useAction } from "@/components/useAction";
import {
  listClaims,
  listDeviceNames,
  listRepoClaims,
  listUsers,
  reviewClaim,
  reviewRepoClaim,
  type AdminUser,
  type Claim,
  type RepoClaim,
} from "@/lib/client";
import { cn, formatDate, relativeTime } from "@/lib/utils";

type Decision = "approve" | "reject";

const CARD = "rounded-[14px] border bg-card text-card-foreground";
const CHIP =
  "inline-flex h-7 max-w-full items-center rounded-full border px-2.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11 pointer-coarse:px-3.5 pointer-coarse:text-sm";
const TEXT_LINK = "rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/** Who a claim or account is, as one line and a GitHub login when there is one. */
interface Person {
  name: string;
  login: string | null;
}

function When({ iso, prefix }: { iso?: string | null; prefix?: string }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} title={formatDate(iso)} suppressHydrationWarning>
      {prefix}
      {relativeTime(iso)}
    </time>
  );
}

/** A GitHub avatar, or the first letter of the name when there is no login or the image fails. */
function Avatar({ person, className }: { person: Person; className?: string }) {
  const [failed, setFailed] = useState(false);
  const box = cn("size-10 shrink-0 rounded-full border bg-muted", className);
  if (person.login && !failed) {
    return (
      <img
        src={`https://github.com/${encodeURIComponent(person.login)}.png?size=64`}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={box}
      />
    );
  }
  return (
    <span aria-hidden="true" className={cn(box, "flex items-center justify-center text-sm font-semibold text-muted-foreground")}>
      {(person.name.replace(/^@/, "") || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

function GithubLogin({ login }: { login: string | null }) {
  if (!login) return <span>GitHub not linked</span>;
  return (
    <a href={`https://github.com/${login}`} target="_blank" rel="noopener noreferrer" className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
      @{login}
    </a>
  );
}

/** Approve (primary) and Reject (outline); full width side by side on phones. */
function Decide({ label, busy, onDecide }: { label: string; busy: boolean; onDecide: (d: Decision) => void }) {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:items-center">
      <PrimaryAction onClick={() => onDecide("approve")} disabled={busy} aria-label={`Approve ${label}`} className="w-full sm:w-auto">
        Approve
      </PrimaryAction>
      <Button variant="outline" onClick={() => onDecide("reject")} disabled={busy} aria-label={`Reject ${label}`} className="w-full sm:w-auto">
        Reject
      </Button>
    </div>
  );
}

/** One pending claim: avatar, who and what, when, the note, then the decision. */
function ClaimRow({
  person,
  what,
  meta,
  note,
  label,
  busy,
  onDecide,
}: {
  person: Person;
  what: ReactNode;
  meta: ReactNode;
  note?: string | null;
  label: string;
  busy: boolean;
  onDecide: (d: Decision) => void;
}) {
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 gap-3">
        <Avatar person={person} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm break-words">{what}</p>
          <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">{meta}</p>
          {note ? <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-sm break-words whitespace-pre-line">{note}</p> : null}
        </div>
      </div>
      <Decide label={label} busy={busy} onDecide={onDecide} />
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function Stats({ items }: { items: Array<{ label: string; value: number | null }> }) {
  return (
    <dl className={cn(CARD, "grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-4")}>
      {items.map((s) => (
        <div key={s.label} className="flex min-w-0 flex-col gap-1 bg-card px-4 py-3">
          <dt className="truncate text-xs text-muted-foreground">{s.label}</dt>
          <dd className="h-7">
            {s.value === null ? (
              <Skeleton className="h-6 w-10" label={`Loading ${s.label.toLowerCase()}`} />
            ) : (
              <CountUp value={s.value} className="text-xl leading-7 font-semibold tracking-tight tabular-nums" />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function matches(u: AdminUser, q: string): boolean {
  return [u.display_name, u.github_login, u.email].some((v) => v?.toLowerCase().includes(q));
}

function AccountRow({ user, phoneName }: { user: AdminUser; phoneName: (slug: string) => string }) {
  const name = user.display_name || (user.github_login ? `@${user.github_login}` : `user#${user.id}`);
  const joined = user.created ? formatDate(user.created.slice(0, 10)) : null;
  const maintained = user.maintains.length + user.maintains_repos.length;
  return (
    <li className="flex gap-3 px-4 py-4">
      <Avatar person={{ name, login: user.github_login }} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to="/u/$id" params={{ id: user.github_login || String(user.id) }} className="min-w-0 font-medium break-words underline-offset-4 hover:underline">
            {name}
          </Link>
          {user.is_admin ? <span className="rounded-md border px-1.5 text-xs leading-5 text-muted-foreground">Admin</span> : null}
        </p>
        <p className="flex flex-wrap gap-x-2 text-sm text-muted-foreground">
          <GithubLogin login={user.github_login} />
          {joined ? (
            <span>
              Joined{" "}
              <time dateTime={user.created} title={formatDate(user.created)} suppressHydrationWarning>
                {joined}
              </time>
            </span>
          ) : null}
        </p>
        {user.email ? <p className="text-xs break-all text-muted-foreground">{user.email}</p> : null}
        {maintained ? (
          <ul aria-label={`${name} maintains`} className="mt-1.5 flex flex-wrap gap-1.5">
            {user.maintains.map((slug) => (
              <li key={`d:${slug}`} className="min-w-0">
                <Link to="/device/$slug" params={{ slug }} className={CHIP}>
                  <span className="truncate">{phoneName(slug)}</span>
                </Link>
              </li>
            ))}
            {user.maintains_repos.map((repo) => (
              <li key={`r:${repo}`} className="min-w-0">
                <a href={`https://github.com/${repo}`} target="_blank" rel="noopener noreferrer" className={cn(CHIP, "font-mono")}>
                  <span className="truncate">{repo}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function Accounts({ users, phoneName }: { users: AdminUser[] | null; phoneName: (slug: string) => string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (users && q ? users.filter((u) => matches(u, q)) : users), [users, q]);
  return (
    <Panel title="Accounts" actions={users && q ? <p className="text-sm text-muted-foreground tabular-nums">{shown?.length} of {users.length}</p> : null}>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, GitHub login or email"
          aria-label="Search accounts"
          autoComplete="off"
          spellCheck={false}
          className="pl-9"
        />
      </div>
      {users === null ? (
        <Skeleton className="h-40" label="Loading accounts" />
      ) : shown && shown.length ? (
        <ul className="-mx-4 flex flex-col divide-y border-y sm:mx-0 sm:rounded-lg sm:border">
          {shown.map((u) => (
            <AccountRow key={u.id} user={u} phoneName={phoneName} />
          ))}
        </ul>
      ) : (
        <Empty>{q ? "No account matches." : "No accounts yet."}</Empty>
      )}
    </Panel>
  );
}

export function AdminPanel() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [device, setDevice] = useState<Claim[] | null>(null);
  const [repo, setRepo] = useState<RepoClaim[] | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [phones, setPhones] = useState<Map<string, string>>(new Map());

  const reload = useCallback(async () => {
    const [d, r, u] = await Promise.all([
      listClaims({ status: "pending" }).catch(() => ({ claims: [] as Claim[] })),
      listRepoClaims("pending").catch(() => ({ claims: [] as RepoClaim[] })),
      listUsers().catch(() => ({ users: [] as AdminUser[] })),
    ]);
    setDevice(d.claims);
    setRepo(r.claims.filter((c) => c.status === "pending"));
    setUsers(u.users);
  }, []);
  useEffect(() => {
    void reload();
    listDeviceNames().then(
      (list) => setPhones(new Map(list.map((p) => [p.slug, p.name]))),
      () => {},
    );
  }, [reload]);

  const phoneName = useCallback((slug: string) => phones.get(slug) ?? slug, [phones]);
  const byId = useMemo(() => new Map((users ?? []).map((u) => [u.id, u])), [users]);

  const deviceClaimant = (c: Claim): Person => {
    const u = c.user_id !== undefined ? byId.get(c.user_id) : undefined;
    if (u) return { name: u.display_name || (u.github_login ? `@${u.github_login}` : c.user), login: u.github_login };
    return { name: c.user, login: c.user.startsWith("@") ? c.user.slice(1) : null };
  };
  const repoClaimant = (c: RepoClaim): Person => {
    const u = c.user;
    if (u && typeof u === "object") return { name: u.display_name || (u.github_login ? `@${u.github_login}` : `user#${u.id}`), login: u.github_login };
    if (typeof u === "string" && u) return { name: u, login: u.startsWith("@") ? u.slice(1) : null };
    const known = c.user_id !== undefined ? byId.get(c.user_id) : undefined;
    if (known) return { name: known.display_name || `user#${known.id}`, login: known.github_login };
    return { name: c.user_id ? `user#${c.user_id}` : "Someone", login: null };
  };

  const after = async () => {
    await Promise.all([reload(), refresh(), router.invalidate()]);
  };
  const [decideDevice, busyDevice] = useAction(async (c: Claim, d: Decision) => {
    await reviewClaim(c.id, d);
    toast.success(d === "approve" ? "Claim approved" : "Claim rejected", { description: `${deviceClaimant(c).name} on ${phoneName(c.device_slug)}` });
    await after();
  });
  const [decideRepo, busyRepo] = useAction(async (c: RepoClaim, d: Decision) => {
    await reviewRepoClaim(c.id, d);
    toast.success(d === "approve" ? "Repo claim approved" : "Repo claim rejected", { description: `${repoClaimant(c).name} on ${c.repo}` });
    await after();
  });

  const maintainers = users ? users.filter((u) => u.maintains.length || u.maintains_repos.length).length : null;

  return (
    <div className="flex flex-col gap-6">
      <Stats
        items={[
          { label: "Device claims", value: device?.length ?? null },
          { label: "Repo claims", value: repo?.length ?? null },
          { label: "Accounts", value: users?.length ?? null },
          { label: "Maintainers", value: maintainers },
        ]}
      />

      <Panel title="Device claims" description="Approving makes them the phone's maintainer: they can set its statuses and post updates.">
        {device === null ? (
          <Skeleton className="h-20" label="Loading device claims" />
        ) : device.length === 0 ? (
          <Empty>Nothing waiting.</Empty>
        ) : (
          <ul className="-mx-4 flex flex-col divide-y border-y sm:mx-0 sm:rounded-lg sm:border">
            {device.map((c) => {
              const who = deviceClaimant(c);
              const phone = phoneName(c.device_slug);
              return (
                <ClaimRow
                  key={c.id}
                  person={who}
                  label={`${who.name} on ${phone}`}
                  busy={busyDevice}
                  onDecide={(d) => void decideDevice(c, d)}
                  note={c.note}
                  what={
                    <>
                      <span className="font-medium">{who.name}</span> <span className="text-muted-foreground">wants to maintain</span>{" "}
                      <Link to="/device/$slug" params={{ slug: c.device_slug }} className={TEXT_LINK}>
                        {phone}
                      </Link>
                    </>
                  }
                  meta={
                    <>
                      {who.login && who.name !== `@${who.login}` ? <GithubLogin login={who.login} /> : null}
                      <When iso={c.updated} />
                    </>
                  }
                />
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="Repo claims"
        description="Organization repos waiting for their proof file. Approve only when you know the claimant is in that organization."
      >
        {repo === null ? (
          <Skeleton className="h-20" label="Loading repo claims" />
        ) : repo.length === 0 ? (
          <Empty>Nothing waiting.</Empty>
        ) : (
          <ul className="-mx-4 flex flex-col divide-y border-y sm:mx-0 sm:rounded-lg sm:border">
            {repo.map((c) => {
              const who = repoClaimant(c);
              return (
                <ClaimRow
                  key={c.id}
                  person={who}
                  label={`${who.name} on ${c.repo}`}
                  busy={busyRepo}
                  onDecide={(d) => void decideRepo(c, d)}
                  note={c.note}
                  what={
                    <>
                      <span className="font-medium">{who.name}</span> <span className="text-muted-foreground">claims</span>{" "}
                      <a href={`https://github.com/${c.repo}`} target="_blank" rel="noopener noreferrer" className={cn(TEXT_LINK, "font-mono text-[0.8125rem] break-all")}>
                        {c.repo}
                      </a>
                      {c.device_slug ? (
                        <>
                          {" "}
                          <span className="text-muted-foreground">for</span>{" "}
                          <Link to="/device/$slug" params={{ slug: c.device_slug }} className={TEXT_LINK}>
                            {phoneName(c.device_slug)}
                          </Link>
                        </>
                      ) : null}
                    </>
                  }
                  meta={
                    <>
                      {who.login && who.name !== `@${who.login}` ? <GithubLogin login={who.login} /> : null}
                      <When iso={c.created} />
                      {c.expires ? <When iso={c.expires} prefix="expires " /> : null}
                    </>
                  }
                />
              );
            })}
          </ul>
        )}
      </Panel>

      <Accounts users={users} phoneName={phoneName} />
    </div>
  );
}

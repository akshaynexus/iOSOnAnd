/**
 * Claim prompts: on a phone's page, the unclaimed repos (the signed-in
 * user's own GitHub repos first and highlighted); on the overview, every
 * tracked repo under the signed-in user's GitHub account that nobody has
 * claimed. Claiming opens the claim dialog (src/components/RepoClaim.tsx);
 * its agent prompt also sets up tracker support in the repo.
 */
import { useMemo } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/useAction";
import { Thumb } from "@/components/ProjectsSection";
import { useAuth } from "@/components/auth";
import { ThisIsMine } from "@/components/RepoClaim";
import { LinkGithubCallout } from "@/components/LinkGithub";
import { claimRepo, forkMaintainer, maintainersOf, type Device, type Fork } from "@/lib/client";
import { cn } from "@/lib/utils";

/** Nobody maintains the repo on the tracker yet. */
export function isUnclaimed(f: Fork): boolean {
  return !f.maintainers?.length && f.maintainer_user_id == null && !forkMaintainer(f);
}

const ownerOf = (repo: string) => repo.split("/")[0]?.toLowerCase() ?? "";

function RepoLink({ repo }: { repo: string }) {
  return (
    <a href={`https://github.com/${repo}`} target="_blank" rel="noopener noreferrer" className="font-mono text-sm break-all underline-offset-4 hover:underline">
      {repo}
    </a>
  );
}

/** On a phone's page: claim its repos. Hidden when the phone is maintained and none of its unclaimed repos is the viewer's. */
export function ClaimThisPhone({ device }: { device: Device }) {
  const { user } = useAuth();
  const login = user?.github_login?.toLowerCase() ?? "";
  const unclaimed = device.forks.filter((f) => isUnclaimed(f) && !isDependency(f));
  const yours = login ? unclaimed.filter((f) => ownerOf(f.repo) === login) : [];
  const maintained = maintainersOf(device).length > 0;
  if (yours.length === 0 && maintained) return null;
  const devices = [{ slug: device.slug, name: device.name }];

  if (yours.length) {
    return (
      <section
        aria-labelledby="claim-yours"
        className="flex flex-col gap-3 rounded-[14px] border border-brand/40 bg-brand/5 p-4 sm:p-5"
      >
        <div>
          <h2 id="claim-yours" className="text-base font-semibold">
            {yours.length === 1 ? "This is your repo" : "These are your repos"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nobody maintains {yours.length === 1 ? "it" : "them"} here yet. Claim {yours.length === 1 ? "it" : "them"} to keep the {device.name}&apos;s status current; your
            coding agent can then update it as you work.
          </p>
        </div>
        <ul className="flex flex-col gap-2">
          {yours.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3">
              <RepoLink repo={f.repo} />
              <ThisIsMine repo={f.repo} device={device.slug} devices={devices} label="Claim it" />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section aria-labelledby="claim-phone" className="flex flex-col gap-1 rounded-[14px] border bg-card p-4 sm:p-5">
      <h2 id="claim-phone" className="text-base font-semibold">
        Nobody maintains this phone yet
      </h2>
      <p className="text-sm text-muted-foreground">
        {unclaimed.length
          ? "If one of the repos below is yours, press Claim on it and keep this page current: what works, what doesn't, with sources."
          : "If you work on a port for it, add your repo and keep this page current: what works, what doesn't, with sources."}{" "}
        Your repo isn&apos;t listed? Use &ldquo;Add your repo&rdquo; above.
      </p>
      <LinkGithubCallout className="mt-2" text="Your repos are then recognised here, and claiming one is approved at once." />
    </section>
  );
}

/**
 * A repo that is not a port of its own: a dependency or submodule of another
 * project (no phone, or the "tooling" family), e.g. OneOS, the switcher app
 * of OneiOS. Claiming it alone makes little sense; it is linked to the
 * project that uses it instead.
 */
export function isDependency(f: Fork): boolean {
  return !f.device_slug || (f.base_project ?? "").toLowerCase() === "tooling";
}

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
const nameOf = (repo: string) => repo.split("/").slice(1).join("/") || repo;

/** The project (a repo the user maintains) a dependency belongs to: one built on it, or named in its description. */
function parentOf(part: Fork, mine: Fork[]): Fork | null {
  const bases = new Set([lc(part.repo), ...(part.based_on ?? []).filter((b) => b.relation === "fork-of").map((b) => lc(b.base))]);
  const byLineage = mine.find((m) => (m.based_on ?? []).some((b) => bases.has(lc(b.base))));
  if (byLineage) return byLineage;
  const text = lc(`${part.best_result} ${part.notes}`);
  return mine.find((m) => text.includes(lc(nameOf(m.repo)))) ?? null;
}

function Avatar({ owner }: { owner: string }) {
  return (
    <img
      src={`https://github.com/${encodeURIComponent(owner)}.png?size=64`}
      alt=""
      loading="lazy"
      className="size-9 shrink-0 rounded-lg border bg-muted object-cover"
      onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
    />
  );
}

/** Link every part to its project in one go: they are the user's own repos, so each claim is approved at once. */
function LinkParts({ parent, parts }: { parent: Fork; parts: Fork[] }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [run, busy] = useAction(async () => {
    for (const p of parts) await claimRepo({ repo: p.repo, note: `part of ${parent.repo}` });
    toast.success(`Linked ${parts.length} ${parts.length === 1 ? "repo" : "repos"} to ${nameOf(parent.repo)}`);
    await Promise.all([refresh(), router.invalidate()]);
  });
  return (
    <Button variant="outline" size="sm" onClick={() => void run()} disabled={busy} className="shrink-0">
      Link to {nameOf(parent.repo)}
    </Button>
  );
}

/** On the overview: the signed-in user's GitHub repos the tracker lists and nobody has claimed. */
export function YourReposToClaim({ forks, devices, className }: { forks: Fork[]; devices: Device[]; className?: string }) {
  const { user } = useAuth();
  const login = user?.github_login?.toLowerCase() ?? "";
  const byDevice = useMemo(() => new Map(devices.map((d) => [d.slug, d])), [devices]);
  if (!login) return null;
  const yours = forks.filter((f) => isUnclaimed(f) && ownerOf(f.repo) === login);
  if (!yours.length) return null;
  const mine = forks.filter((f) => !isUnclaimed(f) && (f.maintainers ?? []).some((m) => lc(m.github_login) === login));
  const ports = yours.filter((f) => !isDependency(f));
  const groups = new Map<number, { parent: Fork; parts: Fork[] }>();
  const loose: Fork[] = [];
  for (const p of yours.filter(isDependency)) {
    const parent = parentOf(p, mine);
    if (!parent) {
      loose.push(p);
      continue;
    }
    const g = groups.get(parent.id) ?? { parent, parts: [] };
    g.parts.push(p);
    groups.set(parent.id, g);
  }
  const pickable = devices.map((d) => ({ slug: d.slug, name: d.name }));
  const rowCls = "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center";
  return (
    <section aria-labelledby="your-repos" className={cn("flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-card text-card-foreground", className)}>
      <header className="flex flex-col gap-1 p-4 sm:px-5">
        <h2 id="your-repos" className="text-base font-semibold">
          Your repos on the tracker
        </h2>
        <p className="text-sm text-muted-foreground">
          Under @{user?.github_login} and not claimed yet. They are yours on GitHub, so a claim goes through at once.
        </p>
      </header>
      <ul className="flex flex-col divide-y border-t">
        {ports.map((f) => {
          const d = f.device_slug ? byDevice.get(f.device_slug) : undefined;
          return (
            <li key={f.id} className={rowCls}>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                {d ? <Thumb device={d} className="size-10 shrink-0" /> : <Avatar owner={ownerOf(f.repo)} />}
                <div className="min-w-0">
                  <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <a href={`https://github.com/${f.repo}`} target="_blank" rel="noopener noreferrer" className="font-medium break-all hover:underline">
                      {f.repo}
                    </a>
                    {d ? (
                      <Link to="/device/$slug" params={{ slug: d.slug }} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
                        {d.name}
                      </Link>
                    ) : null}
                  </p>
                  {f.best_result ? <p className="line-clamp-1 text-sm text-muted-foreground">{f.best_result}</p> : null}
                </div>
              </div>
              <ThisIsMine repo={f.repo} device={f.device_slug} devices={pickable} compact label="Claim" />
            </li>
          );
        })}
        {[...groups.values()].map(({ parent, parts }) => (
          <li key={parent.id} className={rowCls}>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar owner={ownerOf(parent.repo)} />
              <div className="min-w-0">
                <p className="font-medium">Parts of {nameOf(parent.repo)}</p>
                <p className="flex flex-wrap gap-1.5 pt-1">
                  {parts.map((p) => (
                    <a
                      key={p.id}
                      href={`https://github.com/${p.repo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={p.best_result || p.repo}
                      className="inline-flex h-6 items-center rounded-full border px-2 font-mono text-xs hover:bg-muted"
                    >
                      {nameOf(p.repo)}
                    </a>
                  ))}
                </p>
              </div>
            </div>
            <LinkParts parent={parent} parts={parts} />
          </li>
        ))}
        {loose.length ? (
          <li className={rowCls}>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Avatar owner={login} />
              <div className="min-w-0">
                <p className="font-medium">Tools and dependencies</p>
                <p className="text-sm text-muted-foreground">{loose.map((p) => nameOf(p.repo)).join(", ")}: no phone of their own; claim them from a project you maintain.</p>
              </div>
            </div>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

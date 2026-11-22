import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/Field";
import { useAuth } from "@/components/auth";
import { useAction } from "@/components/useAction";
import { CopyButton, PrimaryAction } from "@/components/common";
import { agentPrompt } from "@/lib/agentPrompt";
import { claimRepo, verifyRepoClaim, type RepoClaim } from "@/lib/client";
import { formatDate, relativeTime } from "@/lib/utils";

function useSite(): string {
  const [site, setSite] = useState("");
  useEffect(() => setSite(window.location.origin), []);
  return site;
}

/** OWNER/REPO from "owner/repo", a github.com URL, or with a trailing .git. */
export function normalizeRepo(input: string): string {
  let s = input.trim();
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i.exec(s);
  if (m) s = `${m[1]}/${m[2]}`;
  return s.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
}

/** The agent prompt in a read-only box with a copy button. */
export function PromptBox({ repo, device, className }: { repo?: string; device?: string; className?: string }) {
  const site = useSite();
  const text = agentPrompt({ site: site || "https://<this site>", repo, device });
  return (
    <div className={className}>
      <div className="overflow-hidden rounded-lg border bg-muted/40">
        <div className="flex items-center justify-end border-b bg-background/60 p-1.5">
          <CopyButton text={text} label="Copy prompt" toastText="Prompt copied" size="xs" variant="ghost" />
        </div>
        <pre
          suppressHydrationWarning
          className="max-h-56 overflow-auto p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
        >
          {text}
        </pre>
      </div>
    </div>
  );
}

/** What to do after a claim: done, or the proof file to push and verify. */
export function ClaimNextStep({ claim, onDone }: { claim: RepoClaim; onDone?: () => void }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const [current, setCurrent] = useState(claim);
  const [verify, verifying] = useAction(async () => {
    const res = await verifyRepoClaim(current.id);
    setCurrent(res.claim);
    toast.success(`You maintain ${res.claim.repo || current.repo} now`);
    await Promise.all([refresh(), router.invalidate()]);
    onDone?.();
  });

  if (current.status === "approved") {
    return (
      <p className="rounded-lg border bg-works-soft px-3 py-2 text-works-fg" role="status">
        Claim approved. You maintain {current.repo}.
      </p>
    );
  }
  if (current.status === "rejected" || current.status === "expired") {
    return (
      <p className="rounded-lg border px-3 py-2 text-muted-foreground" role="status">
        This claim was {current.status}. Start a new one to try again.
      </p>
    );
  }
  const path = current.path || ".iosonand-verify";
  const nonce = current.nonce ?? "";
  const cmd = `printf '%s\\n' '${nonce}' > ${path} && git add ${path} && git commit -m "iOSOnAnd verification" && git push`;
  return (
    <div className="flex flex-col gap-3" role="status">
      <p>
        Prove you control <span className="font-medium">{current.repo}</span>: put this code alone in{" "}
        <code className="font-mono text-xs">{path}</code> on the default branch, push, then verify.
        {current.expires ? (
          <>
            {" "}
            The code expires{" "}
            <time dateTime={current.expires} title={formatDate(current.expires)} suppressHydrationWarning>
              {relativeTime(current.expires)}
            </time>
            .
          </>
        ) : null}
      </p>
      {nonce ? (
        <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted py-1 pr-1 pl-3">
          <code className="min-w-0 flex-1 font-mono text-sm break-all">{nonce}</code>
          <CopyButton text={nonce} label="Copy code" toastText="Code copied" variant="ghost" />
        </div>
      ) : null}
      {nonce ? (
        <div className="flex min-w-0 items-start gap-2 rounded-md border py-1 pr-1 pl-3">
          <code className="min-w-0 flex-1 py-1.5 font-mono text-xs break-all">{cmd}</code>
          <CopyButton text={cmd} label="Copy" toastText="Command copied" variant="ghost" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void verify()} disabled={verifying}>
          {verifying ? "Checking the file" : "Verify"}
        </Button>
        <span className="text-xs text-muted-foreground">Delete the file after the claim is approved.</span>
      </div>
    </div>
  );
}

/**
 * The claim dialog for a repo row ("This is mine") and for a new repo ("Add
 * your repo", no `repo`). It shows the agent prompt; logged-in users can also
 * claim right here.
 */
export function ClaimRepoDialog({
  open,
  onOpenChange,
  repo,
  device,
  devices,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repo?: string;
  device?: string | null;
  devices: { slug: string; name: string }[];
}) {
  const router = useRouter();
  const { user, loading, refresh } = useAuth();
  const [repoInput, setRepoInput] = useState(repo ?? "");
  const [deviceInput, setDeviceInput] = useState(device ?? "");
  const [claim, setClaim] = useState<RepoClaim | null>(null);
  useEffect(() => {
    if (!open) return;
    setRepoInput(repo ?? "");
    setDeviceInput(device ?? "");
    setClaim(null);
  }, [open, repo, device]);

  const sorted = useMemo(() => [...devices].sort((a, b) => a.name.localeCompare(b.name)), [devices]);
  const promptRepo = repo ?? (normalizeRepo(repoInput) || undefined);
  const promptDevice = (device ?? deviceInput) || undefined;

  const [submit, submitting] = useAction(async () => {
    const r = normalizeRepo(repoInput);
    if (!/^[\w.-]+\/[\w.-]+$/.test(r)) {
      toast.error("Enter the repo as OWNER/REPO", { description: "For example akshaynexus/OneiOS." });
      return;
    }
    const res = await claimRepo({ repo: r, device: deviceInput || undefined });
    setClaim(res.claim);
    if (res.already) {
      toast.success(`You already maintain ${res.claim.repo || r}`);
    } else if (res.claim.status === "approved") {
      toast.success(`You maintain ${res.claim.repo || r} now`);
      await Promise.all([refresh(), router.invalidate()]);
    }
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  const redirect = typeof window === "undefined" ? "/" : window.location.pathname + window.location.search;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{repo ? `Claim ${repo}` : "Add your repo"}</DialogTitle>
          <DialogDescription>
            Paste the prompt into your coding agent. It gets the tracker CLI, claims the repo and records what works.
          </DialogDescription>
        </DialogHeader>
        <PromptBox repo={promptRepo} device={promptDevice} />
        {claim ? (
          <ClaimNextStep claim={claim} onDone={() => onOpenChange(false)} />
        ) : loading ? null : user ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-3 border-t pt-4">
            <p className="font-medium">Or claim it here</p>
            {repo ? null : (
              <Field id="claim-repo" label="Repo" hint="OWNER/REPO or the GitHub URL">
                <Input
                  id="claim-repo"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  placeholder="owner/repo"
                  autoComplete="off"
                  required
                />
              </Field>
            )}
            {device ? null : (
              <Field id="claim-device" label="Phone" hint={repo ? undefined : "Needed when the repo is not tracked yet"}>
                <NativeSelect id="claim-device" value={deviceInput} onChange={(e) => setDeviceInput(e.target.value)}>
                  <option value="">Choose a phone</option>
                  {sorted.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <div className="flex items-center gap-3">
              <PrimaryAction type="submit" disabled={submitting}>
                {submitting ? "Claiming" : "Claim now"}
              </PrimaryAction>
              {user.github_login ? (
                <span className="text-xs text-muted-foreground">
                  Repos under @{user.github_login} are approved at once.
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  <Link to="/profile" className="underline underline-offset-4">
                    Link GitHub
                  </Link>{" "}
                  to have your own repos approved at once.
                </span>
              )}
            </div>
          </form>
        ) : (
          <p className="border-t pt-4 text-muted-foreground">
            <Link to="/login" search={{ redirect }} className="text-foreground underline underline-offset-4">
              Log in
            </Link>{" "}
            to claim it here instead.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "This is mine" on a repo row: opens the claim dialog for that repo. */
export function ThisIsMine({
  repo,
  device,
  devices,
  compact = false,
}: {
  repo: string;
  device: string | null;
  devices: { slug: string; name: string }[];
  /** A plain outline button for table rows (the SpecularButton stays for panels and cards). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <Button variant="outline" size="xs" onClick={() => setOpen(true)} aria-label={`This is mine: ${repo}`}>
          This is mine
        </Button>
      ) : (
        <PrimaryAction onClick={() => setOpen(true)} aria-label={`This is mine: ${repo}`}>
          This is mine
        </PrimaryAction>
      )}
      {open ? (
        <ClaimRepoDialog open={open} onOpenChange={setOpen} repo={repo} device={device} devices={devices} />
      ) : null}
    </>
  );
}

/** The "Do you maintain one of these repos?" panel (Repos tab), or its short form (Overview). */
export function MaintainPanel({
  devices,
  short = false,
}: {
  devices: { slug: string; name: string }[];
  short?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-labelledby={short ? "maintain-short" : "maintain-heading"}
      className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-4 sm:px-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 id={short ? "maintain-short" : "maintain-heading"} className="text-base font-semibold">
            Do you maintain one of these repos?
          </h2>
          <p className="mt-1 text-muted-foreground">
            {short
              ? "Claim it and keep your phone's status current yourself."
              : "Claim it to keep your phone's status current. Copy the prompt into your coding agent, or claim the repo here."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {short ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/" search={{ tab: "repos" }}>All repos</Link>} />
          ) : null}
          <PrimaryAction onClick={() => setOpen(true)}>Add your repo</PrimaryAction>
        </div>
      </div>
      {short ? null : <PromptBox />}
      {open ? <ClaimRepoDialog open={open} onOpenChange={setOpen} devices={devices} /> : null}
    </section>
  );
}

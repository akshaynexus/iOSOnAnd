import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { useAuth } from "@/components/auth";
import { useAction } from "@/components/useAction";
import { CopyButton, PrimaryAction } from "@/components/common";
import { agentPrompt, portPrompt, trackerSupportPrompt } from "@/lib/agentPrompt";
import { claimRepo, getForkByRepo, listDeviceNames, searchCatalog, verifyRepoClaim, type CatalogEntry, type Fork, type RepoClaim } from "@/lib/client";
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
          <CopyButton text={text} label="Copy prompt" toastText="Prompt copied" size="sm" variant="ghost" />
        </div>
        <pre
          suppressHydrationWarning
          className="max-h-56 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {text}
        </pre>
      </div>
    </div>
  );
}

/** A copyable agent prompt, folded under a summary line. */
export function PromptDetails({ summary, intro, text, open = false }: { summary: string; intro: string; text: string; open?: boolean }) {
  return (
    <details className="rounded-lg border" open={open}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">{summary}</summary>
      <div className="flex flex-col gap-2 border-t p-3">
        <p className="text-sm text-muted-foreground">{intro}</p>
        <div className="overflow-hidden rounded-lg border bg-muted/40">
          <div className="flex items-center justify-end border-b bg-background/60 p-1.5">
            <CopyButton text={text} label="Copy prompt" toastText="Prompt copied" size="sm" variant="ghost" />
          </div>
          <pre suppressHydrationWarning className="max-h-72 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
            {text}
          </pre>
        </div>
      </div>
    </details>
  );
}

/**
 * "Add tracker support to your repo": the prompt that has the maintainer's
 * coding agent keep the key out of git and add a Tracker section to the
 * repo's agent instructions, so later sessions record progress as they go.
 */
export function TrackerSupportBox({ repo, device, open = false }: { repo?: string; device?: string | null; open?: boolean }) {
  const site = useSite();
  return (
    <PromptDetails
      summary="Add tracker support to your repo"
      intro="Paste this into your coding agent in the repo. It keeps your key out of git and adds a short Tracker section to the repo's agent instructions, so every later session updates the tracker as you make progress."
      text={trackerSupportPrompt({ site: site || "https://<this site>", repo, device: device ?? undefined })}
      open={open}
    />
  );
}

/**
 * "Port iOS to your phone": the prompt that has a coding agent research the
 * phone, match it to a base project and the closest ports with the CLI's
 * `references`, and plan the port. Filled in on a phone's page.
 */
export function PortPromptBox({
  device,
  deviceName,
  open = false,
  summary,
}: {
  device?: string;
  deviceName?: string;
  open?: boolean;
  /** The expander's label, when a heading above already names the prompt. */
  summary?: string;
}) {
  const site = useSite();
  return (
    <PromptDetails
      summary={summary ?? (deviceName ? `Port iOS to the ${deviceName}` : "Port iOS to your phone")}
      intro="Paste this into your coding agent. It looks up your phone's specs, uses the tracker to pick the project to start from and the ports on the closest chip, finds working parts (GPU, Wi-Fi, audio) in other repos, and shows you a plan before touching anything."
      text={portPrompt({ site: site || "https://<this site>", device, deviceName })}
      open={open}
    />
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
      <div className="flex flex-col gap-3">
        <p className="rounded-lg border bg-works-soft px-3 py-2 text-works-fg" role="status">
          Claim approved. You maintain {current.repo}.
        </p>
        <TrackerSupportBox repo={current.repo} device={current.device_slug} open />
      </div>
    );
  }
  if (current.status === "rejected" || current.status === "expired") {
    return (
      <p className="rounded-lg border px-3 py-2 text-muted-foreground" role="status">
        This claim was {current.status}. Start a new one to try again.
      </p>
    );
  }
  if (current.status === "pending" && current.method === "review") {
    return (
      <p className="rounded-lg border px-3 py-2" role="status">
        Claim sent. A maintainer of {current.repo} (or an admin) approves it from their profile; then you join its maintainers and maintain its phones too.
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

type Phone = { slug: string; name: string };
type PhoneChoice = { kind: "listed"; slug: string } | { kind: "new"; name: string; model: string; soc: string } | null;

/** Search a listed phone, or say it is not listed and name it. */
function PhonePicker({
  phones,
  value,
  onChange,
  required,
}: {
  phones: Phone[];
  value: PhoneChoice;
  onChange: (v: PhoneChoice) => void;
  required: boolean;
}) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? phones.filter((p) => p.name.toLowerCase().includes(t) || p.slug.includes(t)) : phones;
    return list.slice(0, 8);
  }, [phones, q]);
  // Every Android phone and tablet (Google Play's list), for phones the tracker does not list yet.
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setCatalog([]);
      return;
    }
    const timer = setTimeout(() => {
      searchCatalog(t, 6).then(
        (rows) => setCatalog(rows.filter((r) => !r.tracked)),
        () => setCatalog([]),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  if (value?.kind === "listed") {
    const name = phones.find((p) => p.slug === value.slug)?.name ?? value.slug;
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
        <span className="font-medium">{name}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }
  if (value?.kind === "new") {
    const set = (k: "name" | "model" | "soc", v: string) => onChange({ ...value, [k]: v });
    return (
      <div className="flex flex-col gap-3 rounded-md border p-3">
        <Field id="new-phone-name" label="Phone name">
          <Input id="new-phone-name" value={value.name} onChange={(e) => set("name", e.target.value)} placeholder="Redmi Note 7" required autoFocus />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="new-phone-model" label="Codename or model">
            <Input id="new-phone-model" value={value.model} onChange={(e) => set("model", e.target.value)} placeholder="lavender" />
          </Field>
          <Field id="new-phone-soc" label="Chip">
            <Input id="new-phone-soc" value={value.soc} onChange={(e) => set("soc", e.target.value)} placeholder="Snapdragon 660" />
          </Field>
        </div>
        <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => onChange(null)}>
          Pick a listed phone instead
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Input
        id="claim-phone"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search phones, e.g. Pixel 4 or s24"
        autoComplete="off"
        aria-controls="claim-phone-list"
        required={required}
      />
      <ul id="claim-phone-list" role="listbox" aria-label="Phones" className="flex max-h-56 flex-col overflow-y-auto rounded-md border">
        {hits.map((p) => (
          <li key={p.slug} role="option" aria-selected={false}>
            <button
              type="button"
              className="w-full px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none pointer-coarse:py-3"
              onClick={() => onChange({ kind: "listed", slug: p.slug })}
            >
              {p.name}
            </button>
          </li>
        ))}
        {catalog.length ? (
          <li role="presentation" className="border-t px-3 pt-2 pb-1 text-xs text-muted-foreground">
            Not tracked yet: add it
          </li>
        ) : null}
        {catalog.map((c) => (
          <li key={`cat-${c.id}`} role="option" aria-selected={false}>
            <button
              type="button"
              className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none pointer-coarse:py-3"
              onClick={() => onChange({ kind: "new", name: c.display, model: c.codenames[0] ?? c.models[0] ?? "", soc: "" })}
            >
              <span>{c.display}</span>
              {c.codenames[0] ? <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.codenames[0]}</span> : null}
            </button>
          </li>
        ))}
        <li role="option" aria-selected={false} className="border-t">
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none pointer-coarse:py-3"
            onClick={() => onChange({ kind: "new", name: q.trim(), model: "", soc: "" })}
          >
            {catalog.length ? "None of these: type the name yourself" : `My phone isn't listed${q.trim() ? `: add "${q.trim()}"` : ""}`}
          </button>
        </li>
      </ul>
    </div>
  );
}

/**
 * The claim dialog: "This is mine" on a repo row (`repo` set), "Add your repo"
 * (nothing set, or `device` set on a phone's page). Paste the repo; the
 * dialog says whether the tracker lists it and for which phones, and who can
 * claim it. Pick the phone (or name one that is not listed) and claim. The
 * agent prompt is the other way, folded away.
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
  devices: Phone[];
}) {
  const router = useRouter();
  const { user, loading, refresh } = useAuth();
  const [repoInput, setRepoInput] = useState(repo ?? "");
  const [phone, setPhone] = useState<PhoneChoice>(device ? { kind: "listed", slug: device } : null);
  const [claim, setClaim] = useState<RepoClaim | null>(null);
  const [phones, setPhones] = useState<Phone[]>(devices);
  const [lookup, setLookup] = useState<{ repo: string; fork: Fork | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    setRepoInput(repo ?? "");
    setPhone(device ? { kind: "listed", slug: device } : null);
    setClaim(null);
  }, [open, repo, device]);

  // The full phone list for the picker (a phone's page passes only its own).
  useEffect(() => {
    if (!open || devices.length > 1) return;
    listDeviceNames().then((all) => setPhones(all.length ? all : devices), () => setPhones(devices));
  }, [open, devices]);

  const normalized = normalizeRepo(repoInput);
  const valid = /^[\w.-]+\/[\w.-]+$/.test(normalized);
  // Is the repo tracked already? Looked up as you type (debounced).
  useEffect(() => {
    if (!valid) {
      setLookup(null);
      return;
    }
    const t = setTimeout(() => {
      getForkByRepo(normalized).then(
        (fork) => setLookup({ repo: normalized, fork }),
        () => setLookup(null),
      );
    }, 350);
    return () => clearTimeout(t);
  }, [normalized, valid]);

  const fork = lookup?.repo === normalized ? lookup.fork : undefined;
  const sorted = useMemo(() => [...phones].sort((a, b) => a.name.localeCompare(b.name)), [phones]);
  const listedOn = fork ? [fork.device_slug, ...(fork.supports ?? []).map((x) => x.device_slug)].filter((x, i, a): x is string => !!x && a.indexOf(x) === i) : [];
  const owner = valid ? normalized.split("/")[0] : "";
  const yours = !!user?.github_login && owner.toLowerCase() === user.github_login.toLowerCase();
  const phoneRequired = fork === null; // a repo the tracker does not list needs its phone
  const promptRepo = valid ? normalized : undefined;
  const promptDevice = phone?.kind === "listed" ? phone.slug : undefined;

  const [submit, submitting] = useAction(async () => {
    if (!valid) {
      toast.error("Enter the repo as OWNER/REPO", { description: "For example akshaynexus/OneiOS, or paste the GitHub link." });
      return;
    }
    if (phoneRequired && !phone) {
      toast.error("Pick the phone this repo is for");
      return;
    }
    const res = await claimRepo({
      repo: normalized,
      ...(phone?.kind === "listed" ? { device: phone.slug } : {}),
      ...(phone?.kind === "new" ? { new_device: { name: phone.name.trim(), model: phone.model.trim() || undefined, soc: phone.soc.trim() || undefined } } : {}),
    });
    setClaim(res.claim);
    const name = res.claim?.repo || normalized;
    if (res.already && res.device_claim) {
      toast.success(`Phone added to ${name}`, {
        description:
          res.device_claim.status === "pending"
            ? "Another user maintains this phone, so an admin reviews your claim on it."
            : "You maintain it now.",
      });
      await Promise.all([refresh(), router.invalidate()]);
      onOpenChange(false);
    } else if (res.already) {
      toast.success(`You already maintain ${name}`);
    } else if (res.claim.status === "approved") {
      toast.success(`You maintain ${name} now`);
      await Promise.all([refresh(), router.invalidate()]);
    }
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  // From the router, not window: the same value on the server and the client.
  const redirect = useRouterState({ select: (s) => s.location.pathname + s.location.searchStr });
  const phoneName = (slug: string) => sorted.find((p) => p.slug === slug)?.name ?? slug;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{repo ? `Claim ${repo}` : "Add your repo"}</DialogTitle>
          <DialogDescription>Claim your port's repo to keep its phones up to date yourself.</DialogDescription>
        </DialogHeader>

        {claim ? (
          <ClaimNextStep claim={claim} onDone={() => onOpenChange(false)} />
        ) : loading ? null : !user ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground">Log in with an account linked to your GitHub to claim a repo.</p>
            <PrimaryAction onClick={() => void router.navigate({ to: "/login", search: { redirect } })}>Log in</PrimaryAction>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {user.github_login ? null : (
              <p className="rounded-md border px-3 py-2 text-sm">
                Claims are checked against the repo's GitHub owner.{" "}
                <Link to="/profile" className="font-medium underline underline-offset-4">
                  Link your GitHub account
                </Link>{" "}
                first.
              </p>
            )}
            {repo ? null : (
              <Field id="claim-repo" label="Repo">
                <Input
                  id="claim-repo"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  placeholder="github.com/you/your-port"
                  autoComplete="off"
                  inputMode="url"
                  required
                />
              </Field>
            )}
            {valid ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {fork === undefined
                  ? "Checking the tracker"
                  : fork
                    ? listedOn.length
                      ? `Listed for ${listedOn.map(phoneName).join(", ")}. Claiming it makes you their maintainer.`
                      : "Listed, with no phone yet."
                    : "Not listed yet: pick the phone it is for."}{" "}
                {yours
                  ? "It's under your GitHub account, so it's approved at once."
                  : user.github_login
                    ? `Owned by @${owner}: if you have commits in it, a maintainer approves your claim; organization members prove it with a file.`
                    : null}
              </p>
            ) : null}
            {device ? null : (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">{fork ? "Add another phone (optional)" : "Phone"}</span>
                <PhonePicker phones={sorted.filter((p) => !listedOn.includes(p.slug))} value={phone} onChange={setPhone} required={phoneRequired && !phone} />
              </div>
            )}
            <PrimaryAction type="submit" size="md" className="w-full" disabled={submitting || !valid}>
              {submitting ? "Claiming" : fork && listedOn.length && !phone ? "Claim repo" : phone?.kind === "new" ? "Add phone and claim" : "Claim repo"}
            </PrimaryAction>
          </form>
        )}

        <details className="group rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">Use your coding agent instead</summary>
          <div className="flex flex-col gap-2 border-t p-3">
            <p className="text-sm text-muted-foreground">Paste this into your agent. It gets the tracker CLI, claims the repo and records what works.</p>
            <PromptBox repo={promptRepo} device={promptDevice} />
          </div>
        </details>
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
  label = "This is mine",
}: {
  repo: string;
  device: string | null;
  devices: { slug: string; name: string }[];
  /** "I work on this" when others maintain it already (the claim joins them). */
  label?: string;
  /** A plain outline button for table rows (the SpecularButton stays for panels and cards). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <Button variant="outline" size="xs" className="pointer-coarse:h-11 pointer-coarse:px-3" onClick={() => setOpen(true)} aria-label={`${label}: ${repo}`}>
          {label}
        </Button>
      ) : (
        <PrimaryAction onClick={() => setOpen(true)} aria-label={`${label}: ${repo}`}>
          {label}
        </PrimaryAction>
      )}
      {open ? (
        <ClaimRepoDialog open={open} onOpenChange={setOpen} repo={repo} device={device} devices={devices} />
      ) : null}
    </>
  );
}

/** "Add your repo" on a phone's page: the claim dialog with the phone set. */
export function AddRepoToPhone({ device }: { device: { slug: string; name: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PrimaryAction onClick={() => setOpen(true)}>Add your repo</PrimaryAction>
      {open ? <ClaimRepoDialog open={open} onOpenChange={setOpen} device={device.slug} devices={[device]} /> : null}
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
          <p className="mt-1 text-muted-foreground">Claim it and keep your phones' status current yourself. A phone we don't list yet can be added with it.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {short ? (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/" search={{ tab: "repos" }}>All repos</Link>} />
          ) : null}
          <PrimaryAction onClick={() => setOpen(true)}>Add your repo</PrimaryAction>
        </div>
      </div>
      {open ? <ClaimRepoDialog open={open} onOpenChange={setOpen} devices={devices} /> : null}
    </section>
  );
}

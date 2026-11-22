import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/Field";
import { toastError, useAction } from "@/components/useAction";
import { CopyButton, PrimaryAction } from "@/components/common";
import { Skeleton } from "@/components/motion";
import {
  TOKEN_SCOPES,
  listTokens,
  mintToken,
  revokeToken,
  rotateToken,
  type ApiTokenRecord,
  type MintedToken,
} from "@/lib/client";
import { cn, formatDate, parseDate, relativeTime } from "@/lib/utils";

const SCOPE_HINTS: Record<string, string> = {
  all: "Everything your account may do",
  read: "Read only",
  "status:write": "Set area states",
  "fork:write": "Add and edit repos",
  "post:write": "Add Reddit posts",
  "media:write": "Upload photos and clips",
};

const EXPIRY: [string, number | null][] = [
  ["30 days", 30],
  ["90 days", 90],
  ["365 days", 365],
  ["Never", null],
];

function isRevoked(t: ApiTokenRecord): boolean {
  return !!t.revoked && t.revoked !== "0";
}

function isExpired(t: ApiTokenRecord): boolean {
  const d = t.expires ? parseDate(t.expires) : null;
  return !!d && d.getTime() < Date.now();
}

function When({ value, empty }: { value: string | null | undefined; empty: string }) {
  if (!value) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <time dateTime={value} title={formatDate(value)} suppressHydrationWarning>
      {relativeTime(value)}
    </time>
  );
}

/** The secret, shown once, with the line that proves it works. */
function SecretOnce({ minted, onDismiss }: { minted: MintedToken; onDismiss: () => void }) {
  const [site, setSite] = useState("");
  useEffect(() => setSite(window.location.origin), []);
  const line = `TRACKER_URL=${site} TRACKER_TOKEN=${minted.token} node cli.mjs whoami`;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-works/40 bg-works-soft/40 p-4" role="status">
      <p className="font-medium">Copy this key now. It is not shown again.</p>
      <div className="flex min-w-0 items-center gap-2 rounded-md bg-background py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 font-mono text-sm break-all">{minted.token}</code>
        <CopyButton text={minted.token} label="Copy key" toastText="Key copied" variant="ghost" />
      </div>
      <div className="flex min-w-0 items-start gap-2 rounded-md bg-background py-1 pr-1 pl-3">
        <code className="min-w-0 flex-1 py-1.5 font-mono text-xs break-all" suppressHydrationWarning>
          {line}
        </code>
        <CopyButton text={line} label="Copy" toastText="Command copied" variant="ghost" />
      </div>
      <div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (m: MintedToken) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["all"]);
  const [expiry, setExpiry] = useState("90");
  useEffect(() => {
    if (!open) return;
    setName("");
    setScopes(["all"]);
    setExpiry("90");
  }, [open]);

  function toggle(scope: string, on: boolean) {
    setScopes((cur) => {
      if (scope === "all") return on ? ["all"] : [];
      const rest = cur.filter((s) => s !== "all" && s !== scope);
      return on ? [...rest, scope] : rest;
    });
  }

  const [create, creating] = useAction(async () => {
    if (scopes.length === 0) {
      toast.error("Choose at least one scope");
      return;
    }
    const res = await mintToken({
      name: name.trim(),
      scopes,
      expires_in_days: expiry === "never" ? null : Number(expiry),
    });
    onCreated(res);
    onOpenChange(false);
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    void create();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create key</DialogTitle>
          <DialogDescription>A key never does more than your account may.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field id="key-name" label="Name">
            <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="laptop-cli" required />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Scopes</legend>
            {TOKEN_SCOPES.map((s) => {
              const checked = scopes.includes(s);
              const covered = s !== "all" && scopes.includes("all");
              return (
                <label key={s} className={cn("flex cursor-pointer items-center gap-2.5", covered && "opacity-60")}>
                  <input
                    type="checkbox"
                    className="size-4 accent-(--brand)"
                    checked={checked || covered}
                    disabled={covered}
                    onChange={(e) => toggle(s, e.target.checked)}
                  />
                  <code className="font-mono text-xs">{s}</code>
                  <span className="text-xs text-muted-foreground">{SCOPE_HINTS[s]}</span>
                </label>
              );
            })}
          </fieldset>
          <Field id="key-expiry" label="Expires">
            <NativeSelect id="key-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {EXPIRY.map(([label, days]) => (
                <option key={label} value={days === null ? "never" : String(days)}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex justify-end">
            <PrimaryAction type="submit" disabled={creating}>
              {creating ? "Creating" : "Create key"}
            </PrimaryAction>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** API keys: the list (revoke, rotate), the create dialog and the one-time secret. */
export function ApiKeys() {
  const [tokens, setTokens] = useState<ApiTokenRecord[] | null>(null);
  const [minted, setMinted] = useState<MintedToken | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await listTokens();
      setTokens(Array.isArray(res.tokens) ? res.tokens : []);
    } catch (err) {
      toastError(err);
      setTokens([]);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const [revoke, revoking] = useAction(async (t: ApiTokenRecord) => {
    if (!window.confirm(`Revoke "${t.name || t.prefix}"? Anything using it stops working.`)) return;
    await revokeToken(t.id);
    toast.success("Key revoked");
    await reload();
  });
  const [rotate, rotating] = useAction(async (t: ApiTokenRecord) => {
    if (!window.confirm(`Rotate "${t.name || t.prefix}"? The old key stops working now.`)) return;
    const res = await rotateToken(t.id);
    setMinted(res);
    toast.success("Key rotated");
    await reload();
  });

  const active = (tokens ?? []).filter((t) => !isRevoked(t));
  const revoked = (tokens ?? []).filter(isRevoked);

  return (
    <section aria-labelledby="keys-heading" className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 id="keys-heading" className="mr-auto text-xl font-semibold">
          API keys
        </h1>
        <PrimaryAction onClick={() => setCreating(true)}>Create key</PrimaryAction>
      </div>
      {minted ? <SecretOnce minted={minted} onDismiss={() => setMinted(null)} /> : null}
      {tokens === null ? (
        <Skeleton className="h-28" label="Loading keys" />
      ) : tokens.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">
          No keys yet. The CLI and scripts sign in with one.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="h-9 px-3 font-medium">Name</th>
                <th scope="col" className="h-9 px-3 font-medium">Scopes</th>
                <th scope="col" className="hidden h-9 px-3 font-medium md:table-cell">Created</th>
                <th scope="col" className="hidden h-9 px-3 font-medium sm:table-cell">Last used</th>
                <th scope="col" className="h-9 px-3 font-medium">Expires</th>
                <th scope="col" className="w-0 px-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...active, ...revoked].map((t) => {
                const gone = isRevoked(t);
                const expired = !gone && isExpired(t);
                return (
                  <tr key={t.id} className={cn(gone && "text-muted-foreground")}>
                    <td className="px-3 py-2 align-middle">
                      <div className="font-medium">{t.name || "Unnamed"}</div>
                      <code className="font-mono text-xs text-muted-foreground">{t.prefix}</code>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <span className="flex flex-wrap gap-1">
                        {(t.scopes && t.scopes.length > 0 ? t.scopes : ["all"]).map((s) => (
                          <code key={s} className="rounded border px-1.5 font-mono text-[11px]">
                            {s}
                          </code>
                        ))}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2 align-middle whitespace-nowrap md:table-cell">
                      <When value={t.created} empty="Unknown" />
                    </td>
                    <td className="hidden px-3 py-2 align-middle whitespace-nowrap sm:table-cell">
                      <When value={t.last_used} empty="Never" />
                    </td>
                    <td className="px-3 py-2 align-middle whitespace-nowrap">
                      {gone ? (
                        <span>Revoked</span>
                      ) : expired ? (
                        <span className="text-destructive">Expired</span>
                      ) : (
                        <When value={t.expires} empty="Never" />
                      )}
                    </td>
                    <td className="px-2 py-1.5 align-middle">
                      {gone ? null : (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void rotate(t)}
                            disabled={rotating}
                            aria-label={`Rotate ${t.name || t.prefix}`}
                          >
                            Rotate
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => void revoke(t)}
                            disabled={revoking}
                            aria-label={`Revoke ${t.name || t.prefix}`}
                          >
                            Revoke
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {creating ? <CreateKeyDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(m) => {
            setMinted(m);
            void reload();
          }}
        /> : null}
    </section>
  );
}

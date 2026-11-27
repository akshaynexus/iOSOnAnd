import { PrimaryAction } from "@/components/common";
import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, NativeSelect } from "@/components/Field";
import { useAction } from "@/components/useAction";
import { VERIFIED, addFork, updateFork, type Fork, type Verified } from "@/lib/client";

/** Add a fork to a device, or edit one (`fork` given). Editors only. */
export function ForkDialog({ deviceSlug, fork }: { deviceSlug: string; fork?: Fork }) {
  const router = useRouter();
  const editing = !!fork;
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState(fork?.repo ?? "");
  const [branch, setBranch] = useState(fork?.branch ?? "");
  const [url, setUrl] = useState(fork?.url ?? "");
  const [bestResult, setBestResult] = useState(fork?.best_result ?? "");
  const [verified, setVerified] = useState<Verified>(fork?.verified ?? "fork-claim");
  const [notes, setNotes] = useState(fork?.notes ?? "");
  const idp = fork ? `fork-${fork.id}` : `fork-new-${deviceSlug}`;

  const [save, saving] = useAction(async () => {
    const fields = { branch, url: url.trim(), best_result: bestResult, verified, notes };
    if (fork) {
      await updateFork(fork.id, fields);
      toast.success(`${fork.repo} saved`);
    } else {
      const r = repo.trim();
      await addFork({
        ...fields,
        device_slug: deviceSlug,
        repo: r,
        url: fields.url || `https://github.com/${r}`,
      });
      toast.success(`${r} added`);
      setRepo("");
      setBranch("");
      setUrl("");
      setBestResult("");
      setVerified("fork-claim");
      setNotes("");
    }
    setOpen(false);
    await router.invalidate();
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    void save();
  }

  return (
    <>
    <PrimaryAction onClick={() => setOpen(true)} aria-label={editing ? `Edit ${fork.repo}` : undefined}>
      {editing ? "Edit" : "Add fork"}
    </PrimaryAction>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${fork.repo}` : "Add fork"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {editing ? null : (
            <Field id={`${idp}-repo`} label="Repo" hint="owner/name on GitHub">
              <Input
                id={`${idp}-repo`}
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="owner/OneiOS"
                pattern="[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+"
                required
              />
            </Field>
          )}
          <Field id={`${idp}-branch`} label="Branch">
            <Input
              id={`${idp}-branch`}
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
            />
          </Field>
          <Field id={`${idp}-url`} label="URL">
            <Input
              id={`${idp}-url`}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={repo ? `https://github.com/${repo}` : "https://github.com/owner/OneiOS"}
            />
          </Field>
          <Field id={`${idp}-result`} label="Best result">
            <Input id={`${idp}-result`} value={bestResult} onChange={(e) => setBestResult(e.target.value)} />
          </Field>
          <Field
            id={`${idp}-verified`}
            label="Verified"
            hint="fork-claim until reproduced on hardware; merged only for code in main"
          >
            <NativeSelect
              id={`${idp}-verified`}
              value={verified}
              onChange={(e) => setVerified(e.target.value as Verified)}
            >
              {VERIFIED.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id={`${idp}-notes`} label="Notes">
            <Textarea id={`${idp}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving" : editing ? "Save" : "Add fork"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}

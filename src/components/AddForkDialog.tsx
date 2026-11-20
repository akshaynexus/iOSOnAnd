import { useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addFork, errorMessage } from "@/lib/client";
import { toast } from "sonner";

export function AddForkDialog({
  deviceSlug,
  onAdded,
}: {
  deviceSlug?: string;
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [bestResult, setBestResult] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await addFork({
        device_slug: deviceSlug ?? null,
        repo,
        branch,
        best_result: bestResult,
        url: repo ? `https://github.com/${repo}` : "",
      });
      toast.success("Fork added");
      setOpen(false);
      setRepo("");
      setBranch("");
      setBestResult("");
      onAdded();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">Add fork</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add fork</DialogTitle>
          <DialogDescription>Link a fork repo to this device.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="fork-repo" className="text-sm font-medium">
              Repo
            </label>
            <Input
              id="fork-repo"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="owner/OneiOS"
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="fork-branch" className="text-sm font-medium">
              Branch
            </label>
            <Input
              id="fork-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="fork-result" className="text-sm font-medium">
              Best result
            </label>
            <Input
              id="fork-result"
              value={bestResult}
              onChange={(e) => setBestResult(e.target.value)}
              placeholder="Boots to recovery"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              Save fork
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

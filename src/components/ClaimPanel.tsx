import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { ClaimBadge } from "@/components/StatusBadge";
import { useAuth } from "@/components/auth";
import { useAction } from "@/components/useAction";
import { PrimaryAction } from "@/components/common";
import { addClaim, isOwnClaim, withdrawClaim, type Claim } from "@/lib/client";

export function ClaimPanel({ deviceSlug, claims }: { deviceSlug: string; claims: Claim[] }) {
  const router = useRouter();
  const { user, loading, maintains, refresh } = useAuth();
  const [note, setNote] = useState("");
  const mine = user ? claims.filter((c) => isOwnClaim(c, user)) : [];
  const myPending = mine.find((c) => c.status === "pending");
  const maintainer = maintains.includes(deviceSlug) || mine.some((c) => c.status === "approved");

  const [claim, claiming] = useAction(async () => {
    await addClaim({ device_slug: deviceSlug, note: note.trim() });
    toast.success("Claim filed", { description: "An admin reviews it." });
    setNote("");
    await router.invalidate();
  });
  const [withdraw, withdrawing] = useAction(async (id: number) => {
    await withdrawClaim(id);
    toast.success("Claim withdrawn");
    await Promise.all([router.invalidate(), refresh()]);
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    void claim();
  }

  return (
    <div className="flex flex-col gap-4">
      {claims.length === 0 ? (
        <p className="text-muted-foreground">No one has claimed this device yet.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {claims.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
              <ClaimBadge status={c.status} />
              <span className="font-medium">{c.user}</span>
              {c.note ? <span className="min-w-0 break-words text-muted-foreground">{c.note}</span> : null}
            </li>
          ))}
        </ul>
      )}

      {loading ? null : !user ? (
        <p>
          <Link to="/login" search={{ redirect: `/device/${deviceSlug}` }} className="underline underline-offset-4">
            Log in
          </Link>{" "}
          to claim this device.
        </p>
      ) : maintainer ? (
        <p>You maintain this device.</p>
      ) : myPending ? (
        <div className="flex flex-wrap items-center gap-2">
          <p>Your claim is waiting for an admin.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void withdraw(myPending.id)}
            disabled={withdrawing}
          >
            Withdraw
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex max-w-xl flex-col gap-2">
          <Field id="claim-note" label="What you will maintain">
            <Input
              id="claim-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="owner/OneiOS-A56, kernel patches"
            />
          </Field>
          <PrimaryAction type="submit" disabled={claiming} className="self-start">
            {claiming ? "Filing claim" : "Claim this device"}
          </PrimaryAction>
        </form>
      )}
    </div>
  );
}

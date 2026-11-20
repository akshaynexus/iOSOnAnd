import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Page } from "@/components/Page";
import { useAuth } from "@/components/auth";
import { ClaimBadge, StateBadge } from "@/components/StatusBadge";
import { AreaEditor } from "@/components/AreaEditor";
import { AddForkDialog } from "@/components/AddForkDialog";
import { ForksTable } from "@/components/ForksTable";
import { addClaim, errorMessage, getDevice, type Device } from "@/lib/client";
import { toast } from "sonner";

export const Route = createFileRoute("/device/$slug")({
  component: DevicePage,
});

function DevicePage() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const [device, setDevice] = useState<Device | null>(null);
  const [claimNote, setClaimNote] = useState("");
  const [claiming, setClaiming] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await getDevice(slug);
      setDevice(res.device);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function claim() {
    setClaiming(true);
    try {
      await addClaim({ device_slug: slug, note: claimNote });
      toast.success("Claim submitted");
      setClaimNote("");
      await reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setClaiming(false);
    }
  }

  const canEdit = user?.is_admin === true;
  const areaName = (s: string) => device?.area_names[s] ?? s;

  return (
    <Page>
      {!device ? (
        <p>Loading device.</p>
      ) : (
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-4">
              <h1 className="text-3xl font-semibold">{device.name}</h1>
              <StateBadge state={device.status} />
            </div>
            <p className="text-muted-foreground">
              {device.model} {device.soc}
            </p>
            {device.best_result ? <p>{device.best_result}</p> : null}
            {device.notes ? <p className="text-muted-foreground">{device.notes}</p> : null}
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold">Area states</h2>
            {canEdit ? (
              <div className="grid gap-4 md:grid-cols-2">
                {device.statuses.map((s) => (
                  <AreaEditor
                    key={s.area_slug}
                    deviceSlug={device.slug}
                    entry={s}
                    areaName={areaName(s.area_slug)}
                    onSaved={reload}
                  />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Area</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {device.statuses.map((s) => (
                      <TableRow key={s.area_slug}>
                        <TableCell className="font-medium">{areaName(s.area_slug)}</TableCell>
                        <TableCell>
                          <StateBadge state={s.state} />
                        </TableCell>
                        <TableCell>{s.detail || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <h2 className="text-xl font-semibold">Forks</h2>
              {canEdit ? <AddForkDialog deviceSlug={device.slug} onAdded={reload} /> : null}
            </div>
            <ForksTable forks={device.forks} />
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold">Claims</h2>
            {device.claims.length === 0 ? (
              <p>No claims yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {device.claims.map((c) => (
                  <li key={c.id} className="flex gap-2 text-sm">
                    <ClaimBadge status={c.status} />
                    <span className="font-medium">{c.user}</span>
                    <span className="text-muted-foreground">{c.note}</span>
                  </li>
                ))}
              </ul>
            )}
            {user ? (
              <div className="flex flex-col gap-2">
                <label htmlFor="claim-note" className="text-sm font-medium">
                  Claim note
                </label>
                <div className="flex gap-2">
                  <Input
                    id="claim-note"
                    value={claimNote}
                    onChange={(e) => setClaimNote(e.target.value)}
                    placeholder="What you maintain on this device"
                  />
                  <Button onClick={claim} disabled={claiming}>
                    Claim
                  </Button>
                </div>
              </div>
            ) : null}
          </section>

          {device.posts.length > 0 ? (
            <section className="flex flex-col gap-4">
              <h2 className="text-xl font-semibold">Related posts</h2>
              <ul className="flex flex-col gap-2">
                {device.posts.map((p) => (
                  <li key={p.id}>
                    <a href={p.url} target="_blank" rel="noreferrer" className="underline">
                      {p.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Page>
  );
}

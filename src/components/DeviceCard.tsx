import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Device } from "@/lib/client";
import { ClaimBadge, StateBadge, VerifiedBadge } from "@/components/StatusBadge";
import { AreaEditor } from "@/components/AreaEditor";
import { AddForkDialog } from "@/components/AddForkDialog";
import { toast } from "sonner";

function CloneLine({ repo, branch }: { repo: string; branch: string }) {
  const cmd = branch ? `git clone --branch ${branch} https://github.com/${repo}.git` : `git clone https://github.com/${repo}.git`;
  return (
    <div className="flex items-center gap-2 rounded-md bg-neutral-100 p-2 dark:bg-neutral-800">
      <code className="flex-1 overflow-x-auto text-xs">{cmd}</code>
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          await navigator.clipboard.writeText(cmd);
          toast.success("Clone command copied");
        }}
      >
        Copy
      </Button>
    </div>
  );
}

export function DeviceCard({
  device,
  canEdit,
  onChanged,
}: {
  device: Device;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const approved = device.claims.filter((c) => c.status === "approved");
  const areaName = (slug: string) => device.area_names[slug] ?? slug;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>
            <Link to="/device/$slug" params={{ slug: device.slug }}>
              {device.name}
            </Link>
          </CardTitle>
          <span className="ml-auto">
            <StateBadge state={device.status} />
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {device.model} {device.soc}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-wrap gap-2" aria-label="Area checklist">
          {device.statuses.map((s) => (
            <li key={s.area_slug} title={s.detail || areaName(s.area_slug)}>
              <StateBadge state={s.state} />
              <span className="sr-only">{areaName(s.area_slug)}</span>
            </li>
          ))}
        </ul>
        {device.best_result ? <p className="text-sm">{device.best_result}</p> : null}

        <div className="flex flex-col gap-2">
          {device.forks.map((f) => (
            <div key={f.id} className="flex flex-col gap-2 rounded-md border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={f.url || `https://github.com/${f.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium underline"
                >
                  {f.repo}
                </a>
                <VerifiedBadge verified={f.verified} />
              </div>
              <CloneLine repo={f.repo} branch={f.branch} />
              {f.maintainer ? (
                <p className="text-sm text-muted-foreground">Maintainer: {f.maintainer}</p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {approved.length > 0 ? (
            approved.map((c) => (
              <span key={c.id} className="flex items-center gap-2">
                <ClaimBadge status={c.status} />
                <span>{c.user}</span>
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">Unclaimed</span>
          )}
          {canEdit ? <AddForkDialog deviceSlug={device.slug} onAdded={onChanged} /> : null}
        </div>

        {device.posts.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {device.posts.slice(0, 3).map((p) => (
              <li key={p.id}>
                <a href={p.url} target="_blank" rel="noreferrer" className="underline">
                  {p.title}
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {canEdit ? (
          <div className="flex flex-col gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close editor" : "Edit areas"}
            </Button>
            {editing ? (
              <div className="flex flex-col gap-2">
                {device.statuses.map((s) => (
                  <AreaEditor
                    key={s.area_slug}
                    deviceSlug={device.slug}
                    entry={s}
                    areaName={areaName(s.area_slug)}
                    onSaved={onChanged}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

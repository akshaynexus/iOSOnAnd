import { SkeletonFeedRows } from "@/components/motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PrimaryAction } from "@/components/common";
import { useAuth } from "@/components/auth";
import { useAction } from "@/components/useAction";
import { LinkedMedia, checkFile, stripImage } from "@/components/Media";
import { StateLabel } from "@/components/StatusBadge";
import { LinkedText, SourceLink } from "@/components/SourceLink";
import {
  OS_LABELS,
  deleteDeviceUpdate,
  listDeviceUpdates,
  listStatusHistory,
  postDeviceUpdate,
  uploadMedia,
  type DeviceUpdate,
  type Os,
  type StatusChange,
} from "@/lib/client";
import { cn, formatDate, parseDate, relativeTime } from "@/lib/utils";

const MAX_FILES = 10;

function who(u: DeviceUpdate["user"]): string {
  if (!u) return "Someone";
  return u.github_login ? `@${u.github_login}` : u.display_name || `user#${u.id}`;
}

/** Write an update: text, with up to 10 photos or clips (images lose their EXIF data first). */
function Composer({ deviceSlug, onPosted }: { deviceSlug: string; onPosted: () => void }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      const why = checkFile(f);
      if (why) toast.error(f.name, { description: why });
      else if (next.length < MAX_FILES) next.push(f);
    }
    setFiles(next);
    if (input.current) input.current.value = "";
  }

  const [post, posting] = useAction(async () => {
    if (!text.trim() && !files.length) return;
    const ids: number[] = [];
    for (const [i, f] of files.entries()) {
      setProgress(`Uploading ${i + 1} of ${files.length}`);
      const prepared = f.type.startsWith("image/") ? await stripImage(f) : { blob: f, name: f.name };
      const res = await uploadMedia({ file: prepared.blob, filename: prepared.name, device: deviceSlug, caption: text.trim().slice(0, 500) }, () => {});
      ids.push(res.media.id);
    }
    setProgress("Posting");
    try {
      await postDeviceUpdate(deviceSlug, text.trim(), ids);
    } finally {
      setProgress(null);
    }
    toast.success("Update posted");
    setText("");
    setFiles([]);
    onPosted();
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void post();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-[14px] border bg-card p-4">
      <label htmlFor="update-text" className="sr-only">
        What changed
      </label>
      <Textarea
        id="update-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What changed? e.g. Wi-Fi joins networks now, Safari loads pages"
        maxLength={2000}
        rows={3}
      />
      {files.length ? (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex max-w-full items-center gap-1 rounded-full border py-1 pr-1 pl-3 text-sm">
              <span className="max-w-48 truncate">{f.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                disabled={posting}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime"
          multiple
          className="sr-only"
          id="update-files"
          onChange={(e) => addFiles(e.target.files)}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={posting || files.length >= MAX_FILES}>
          Add photos or clips
        </Button>
        <span className="text-xs text-muted-foreground">{files.length ? `${files.length} of ${MAX_FILES}` : "Up to 10; photo metadata is removed"}</span>
        <PrimaryAction type="submit" className="ml-auto" disabled={posting || (!text.trim() && !files.length)}>
          {progress ?? "Post update"}
        </PrimaryAction>
      </div>
    </form>
  );
}

/** Status writes by one person within a few minutes of each other: one entry in the log. */
interface ChangeGroup {
  kind: "changes";
  key: string;
  who: string;
  created: string;
  items: StatusChange[];
}
type Entry = ChangeGroup | { kind: "update"; key: string; created: string; update: DeviceUpdate };

const GROUP_WINDOW_MS = 10 * 60 * 1000;
const time = (iso: string) => parseDate(iso)?.getTime() ?? 0;

/** Newest first: status changes grouped by who and when, and the posted updates between them. */
function timeline(history: StatusChange[], updates: DeviceUpdate[]): Entry[] {
  const groups: ChangeGroup[] = [];
  for (const h of history) {
    const last = groups[groups.length - 1];
    if (last && last.who === h.who && Math.abs(time(last.items[last.items.length - 1].created) - time(h.created)) <= GROUP_WINDOW_MS) {
      last.items.push(h);
    } else {
      groups.push({ kind: "changes", key: `h${h.id}`, who: h.who, created: h.created, items: [h] });
    }
  }
  const entries: Entry[] = [...groups, ...updates.map((u) => ({ kind: "update" as const, key: `u${u.id}`, created: u.created, update: u }))];
  return entries.sort((a, b) => time(b.created) - time(a.created));
}

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} title={formatDate(iso)} suppressHydrationWarning>
      {relativeTime(iso)}
    </time>
  );
}

/** One status change: the area (and system), the state before and after, what was seen and the source. */
function ChangeLine({ c, bare = false }: { c: StatusChange; bare?: boolean }) {
  const os = c.os && c.os !== "ios" ? OS_LABELS[c.os as Os] ?? c.os : null;
  return (
    <li className="flex min-w-0 flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-medium">{c.area_name ?? c.area_slug}</span>
        {os || c.os_version ? <span className="text-muted-foreground">{[os, c.os_version].filter(Boolean).join(" ")}</span> : null}
        <span className="inline-flex items-center gap-1.5">
          {c.old_state ? (
            <>
              <StateLabel state={c.old_state} className="opacity-70" />
              <ArrowRight className="size-3.5 text-muted-foreground" aria-label="to" />
            </>
          ) : null}
          <StateLabel state={c.state} />
        </span>
      </div>
      {!bare && c.detail ? (
        <p className="text-sm break-words text-muted-foreground">
          <LinkedText text={c.detail} />
        </p>
      ) : null}
      {!bare && c.source ? (
        <div>
          <SourceLink source={c.source} />
        </div>
      ) : null}
      <LinkedMedia items={c.media} className="pt-1" />
    </li>
  );
}

const SHOWN_PER_GROUP = 6;

function ChangesCard({ g }: { g: ChangeGroup }) {
  const [all, setAll] = useState(false);
  const items = all ? g.items : g.items.slice(0, SHOWN_PER_GROUP);
  // A sync or session often writes several areas from one source: say it once.
  const shared = g.items.length > 1 && g.items.every((c) => c.detail === g.items[0].detail && c.source === g.items[0].source) ? g.items[0] : null;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[14px] border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{g.who || "Someone"}</span>
        <span>
          {g.items.length === 1 ? "changed an area" : `changed ${g.items.length} areas`}
        </span>
        <When iso={g.created} />
      </div>
      <ul className={cn("flex flex-col", shared ? "gap-0" : "divide-y")}>
        {items.map((c) => (
          <ChangeLine key={c.id} c={c} bare={!!shared} />
        ))}
      </ul>
      {shared && (shared.detail || shared.source) ? (
        <div className="flex flex-col gap-1 border-t pt-3">
          {shared.detail ? (
            <p className="text-sm break-words text-muted-foreground">
              <LinkedText text={shared.detail} />
            </p>
          ) : null}
          {shared.source ? (
            <div>
              <SourceLink source={shared.source} />
            </div>
          ) : null}
        </div>
      ) : null}
      {g.items.length > SHOWN_PER_GROUP ? (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${g.items.length}`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * What changed on a phone, newest first: its status changes (from every
 * write: the site, the CLI, agents and syncs) and its maintainers' posted
 * updates with photos and clips, with the composer for those who can post.
 */
export function DeviceUpdates({ deviceSlug, editable, onPosted }: { deviceSlug: string; editable: boolean; onPosted?: () => void }) {
  const { user, isAdmin } = useAuth();
  const [updates, setUpdates] = useState<DeviceUpdate[] | null>(null);
  const [history, setHistory] = useState<StatusChange[] | null>(null);
  const [nextUpdates, setNextUpdates] = useState<number | null>(null);
  const [nextHistory, setNextHistory] = useState<number | null>(null);

  const loadUpdates = useCallback(
    async (offset = 0) => {
      try {
        const res = await listDeviceUpdates(deviceSlug, offset);
        setUpdates((cur) => (offset ? [...(cur ?? []), ...res.updates] : res.updates));
        setNextUpdates(res.next);
      } catch {
        setUpdates((cur) => cur ?? []);
      }
    },
    [deviceSlug],
  );
  const loadHistory = useCallback(
    async (offset = 0) => {
      try {
        const res = await listStatusHistory(deviceSlug, offset, 40);
        setHistory((cur) => (offset ? [...(cur ?? []), ...res.history] : res.history));
        setNextHistory(res.next);
      } catch {
        setHistory((cur) => cur ?? []);
      }
    },
    [deviceSlug],
  );
  useEffect(() => {
    void loadUpdates();
    void loadHistory();
  }, [loadUpdates, loadHistory]);

  const [remove] = useAction(async (id: number) => {
    await deleteDeviceUpdate(deviceSlug, id);
    toast.success("Update removed");
    await loadUpdates();
  });

  const entries = useMemo(() => timeline(history ?? [], updates ?? []), [history, updates]);
  const loaded = updates !== null && history !== null;
  const more = nextUpdates !== null || nextHistory !== null;
  if (!editable && loaded && !entries.length) return null;
  return (
    <section aria-labelledby="updates-heading" className="flex flex-col gap-3">
      <h2 id="updates-heading" className="text-base font-semibold">
        What changed
      </h2>
      {editable ? (
        <Composer
          deviceSlug={deviceSlug}
          onPosted={() => {
            void loadUpdates();
            onPosted?.();
          }}
        />
      ) : null}
      {!loaded ? (
        <SkeletonFeedRows count={3} label="Loading what changed" className="rounded-[14px] border bg-card" />
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground">
          Nothing yet. Status changes show here as they are made; post what changed with photos, or let your agent run node cli.mjs update.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((e) =>
            e.kind === "changes" ? (
              <li key={e.key}>
                <ChangesCard g={e} />
              </li>
            ) : (
              <li key={e.key} className="flex flex-col gap-3 rounded-[14px] border bg-card p-4">
                <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{who(e.update.user)}</span>
                  <span>posted an update</span>
                  <When iso={e.update.created} />
                  {user && (isAdmin || e.update.user?.id === user.id) ? (
                    <Button variant="ghost" size="xs" className="ml-auto" onClick={() => void remove(e.update.id)}>
                      Remove
                    </Button>
                  ) : null}
                </div>
                {e.update.body ? <p className="whitespace-pre-wrap break-words">{e.update.body}</p> : null}
                {e.update.media.length ? (
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {e.update.media.map((m) => (
                      <li key={m.id} className="overflow-hidden rounded-lg border bg-muted">
                        {m.kind === "video" ? (
                          <video src={m.url} controls preload="metadata" className="aspect-video w-full bg-black object-contain" />
                        ) : (
                          <a href={m.url} target="_blank" rel="noopener noreferrer">
                            <img src={m.url} alt={m.caption || "Update photo"} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ),
          )}
        </ol>
      )}
      {more ? (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          onClick={() => {
            if (nextHistory !== null) void loadHistory(nextHistory);
            if (nextUpdates !== null) void loadUpdates(nextUpdates);
          }}
        >
          Older changes
        </Button>
      ) : null}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PrimaryAction } from "@/components/common";
import { useAuth } from "@/components/auth";
import { useAction } from "@/components/useAction";
import { checkFile, stripImage } from "@/components/Media";
import { deleteDeviceUpdate, listDeviceUpdates, postDeviceUpdate, uploadMedia, type DeviceUpdate } from "@/lib/client";
import { formatDate, relativeTime } from "@/lib/utils";

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

/**
 * A phone's updates from its maintainers, newest first, with the composer for
 * those who can post. Agents post the same with `node cli.mjs update`.
 */
export function DeviceUpdates({ deviceSlug, editable, onPosted }: { deviceSlug: string; editable: boolean; onPosted?: () => void }) {
  const { user, isAdmin } = useAuth();
  const [updates, setUpdates] = useState<DeviceUpdate[] | null>(null);
  const [next, setNext] = useState<number | null>(null);

  const load = useCallback(
    async (offset = 0) => {
      try {
        const res = await listDeviceUpdates(deviceSlug, offset);
        setUpdates((cur) => (offset ? [...(cur ?? []), ...res.updates] : res.updates));
        setNext(res.next);
      } catch {
        setUpdates((cur) => cur ?? []);
      }
    },
    [deviceSlug],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const [remove] = useAction(async (id: number) => {
    await deleteDeviceUpdate(deviceSlug, id);
    toast.success("Update removed");
    await load();
  });

  if (!editable && updates !== null && !updates.length) return null;
  return (
    <section aria-labelledby="updates-heading" className="flex flex-col gap-3">
      <h2 id="updates-heading" className="text-base font-semibold">
        Updates
      </h2>
      {editable ? (
        <Composer
          deviceSlug={deviceSlug}
          onPosted={() => {
            void load();
            onPosted?.();
          }}
        />
      ) : null}
      {updates === null ? null : updates.length === 0 ? (
        <p className="text-muted-foreground">No updates yet. Post what changed, with photos, or let your agent run node cli.mjs update.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {updates.map((u) => (
            <li key={u.id} className="flex flex-col gap-3 rounded-[14px] border bg-card p-4">
              <div className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{who(u.user)}</span>
                <time dateTime={u.created} title={formatDate(u.created)} suppressHydrationWarning>
                  {relativeTime(u.created)}
                </time>
                {user && (isAdmin || u.user?.id === user.id) ? (
                  <Button variant="ghost" size="xs" className="ml-auto" onClick={() => void remove(u.id)}>
                    Remove
                  </Button>
                ) : null}
              </div>
              {u.body ? <p className="whitespace-pre-wrap break-words">{u.body}</p> : null}
              {u.media.length ? (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {u.media.map((m) => (
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
          ))}
        </ol>
      )}
      {next !== null ? (
        <Button variant="outline" size="sm" className="self-center" onClick={() => void load(next)}>
          Older updates
        </Button>
      ) : null}
    </section>
  );
}

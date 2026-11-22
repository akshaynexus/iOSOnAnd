import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/Field";
import { useAuth } from "@/components/auth";
import { toastError, useAction } from "@/components/useAction";
import { PrimaryAction } from "@/components/common";
import { Skeleton, flash } from "@/components/motion";
import {
  ApiRequestError,
  deleteMedia,
  listMedia,
  uploadMedia,
  type Area,
  type Fork,
  type Media,
} from "@/lib/client";
import { cn, formatDate, relativeTime } from "@/lib/utils";

/** The API's limits (contract-v2 "Media"); the server checks magic bytes too. */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const IMAGE_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 95 * 1024 * 1024;

function mb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** A reason the file cannot be uploaded, or null. */
export function checkFile(file: File): string | null {
  const type = file.type.toLowerCase();
  if (IMAGE_TYPES.includes(type)) return file.size > IMAGE_MAX ? `Images can be up to 15 MB; this one is ${mb(file.size)}.` : null;
  if (VIDEO_TYPES.includes(type)) return file.size > VIDEO_MAX ? `Videos can be up to 95 MB; this one is ${mb(file.size)}.` : null;
  return "Use a JPEG, PNG, WebP or AVIF image, or an MP4, WebM or MOV video.";
}

/**
 * Draw the image on a canvas and encode it again, which drops EXIF and GPS
 * data. The orientation from EXIF is applied first. JPEG, PNG and WebP keep
 * their format (quality 0.9); AVIF, which canvases cannot write, becomes WebP.
 */
export async function stripImage(file: File): Promise<{ blob: Blob; name: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot re-encode images");
    ctx.drawImage(bitmap, 0, 0);
    const type = ["image/jpeg", "image/png", "image/webp"].includes(file.type) ? file.type : "image/webp";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    if (!blob) throw new Error("Re-encoding the image failed");
    const ext = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1] || "img";
    const name = `${file.name.replace(/\.[^.]+$/, "") || "image"}.${ext}`;
    return { blob, name, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

interface Prepared {
  blob: Blob;
  name: string;
  kind: "image" | "video";
  preview: string;
  note?: string;
}

/** The upload dialog: drop or pick a file, caption, area and repo, then upload with progress. */
export function UploadDialog({
  open,
  onOpenChange,
  deviceSlug,
  deviceName,
  areas,
  forks,
  forkId,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceSlug: string;
  deviceName: string;
  areas: Area[];
  forks: Fork[];
  forkId?: number | null;
  onUploaded?: (m: Media) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [area, setArea] = useState("");
  const [fork, setFork] = useState(forkId ? String(forkId) : "");
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    setPrepared((p) => {
      if (p) URL.revokeObjectURL(p.preview);
      return null;
    });
    setProblem(null);
    setCaption("");
    setArea("");
    setFork(forkId ? String(forkId) : "");
    setProgress(null);
  }, [open, forkId]);

  async function take(file: File | undefined) {
    if (!file) return;
    const why = checkFile(file);
    setProblem(why);
    setPrepared((p) => {
      if (p) URL.revokeObjectURL(p.preview);
      return null;
    });
    if (why) return;
    if (file.type.startsWith("video/")) {
      setPrepared({
        blob: file,
        name: file.name,
        kind: "video",
        preview: URL.createObjectURL(file),
        note: "Videos upload as they are. Remove location data from the file before uploading.",
      });
      return;
    }
    setPreparing(true);
    try {
      const out = await stripImage(file);
      if (out.blob.size > IMAGE_MAX) {
        setProblem(`After re-encoding the image is ${mb(out.blob.size)}; images can be up to 15 MB.`);
        return;
      }
      setPrepared({
        blob: out.blob,
        name: out.name,
        kind: "image",
        preview: URL.createObjectURL(out.blob),
        note: `Location and camera data removed. ${out.width} by ${out.height}, ${mb(out.blob.size)}.`,
      });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "This image could not be read.");
    } finally {
      setPreparing(false);
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void take(e.dataTransfer.files?.[0]);
  }

  const [upload, uploading] = useAction(async () => {
    if (!prepared) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    try {
      const res = await uploadMedia(
        {
          file: prepared.blob,
          filename: prepared.name,
          device: deviceSlug,
          fork_id: fork ? Number(fork) : null,
          area: area || null,
          caption: caption.trim(),
        },
        setProgress,
        controller.signal,
      );
      toast.success("Uploaded", { description: caption.trim() || deviceName });
      onUploaded?.(res.media);
      onOpenChange(false);
      await router.invalidate();
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void upload();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (uploading ? undefined : onOpenChange(o))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload to {deviceName}</DialogTitle>
          <DialogDescription>Images up to 15 MB, videos up to 95 MB.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-4 text-center transition-colors",
              dragging ? "border-ring bg-muted" : "bg-muted/30",
            )}
          >
            {prepared ? (
              prepared.kind === "image" ? (
                <img src={prepared.preview} alt="Preview" className="max-h-56 rounded-md object-contain" />
              ) : (
                <video src={prepared.preview} controls preload="metadata" className="max-h-56 rounded-md" />
              )
            ) : (
              <ImagePlus className="size-8 text-muted-foreground" aria-hidden />
            )}
            <div className="flex flex-col items-center gap-1">
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
                {prepared ? "Choose another file" : "Choose a file"}
              </Button>
              {prepared ? null : <span className="text-xs text-muted-foreground">or drop it here</span>}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                void take(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          {preparing ? <p className="text-sm text-muted-foreground" role="status">Removing location data</p> : null}
          {problem ? (
            <p className="text-sm text-destructive" role="alert">
              {problem}
            </p>
          ) : null}
          {prepared?.note ? <p className="text-xs text-muted-foreground">{prepared.note}</p> : null}
          <Field id="up-caption" label="Caption">
            <Input id="up-caption" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="up-area" label="Area">
              <NativeSelect id="up-area" value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">None</option>
                {areas.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="up-fork" label="Repo">
              <NativeSelect id="up-fork" value={fork} onChange={(e) => setFork(e.target.value)}>
                <option value="">None</option>
                {forks.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.repo}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {progress !== null ? (
            <div className="flex items-center gap-3" role="status" aria-live="polite">
              <div
                className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
                aria-label="Upload progress"
              >
                <div className="h-full rounded-full bg-brand transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="w-10 text-right text-xs tabular-nums">{Math.round(progress * 100)}%</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            </div>
          ) : null}
          <div className="flex justify-end">
            <PrimaryAction type="submit" disabled={!prepared || uploading || preparing}>
              {uploading ? "Uploading" : "Upload"}
            </PrimaryAction>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The Upload button and its dialog. Shown only to the device's maintainers and admins. */
export function UploadButton({
  allowed,
  compact = false,
  ...props
}: Omit<Parameters<typeof UploadDialog>[0], "open" | "onOpenChange"> & {
  /** Override who sees it (a repo row: the repo maintainer). Default: device maintainers and admins. */
  allowed?: boolean;
  /** A plain outline button for table rows. */
  compact?: boolean;
}) {
  const { canEdit } = useAuth();
  const [open, setOpen] = useState(false);
  if (!(allowed ?? canEdit(props.deviceSlug))) return null;
  return (
    <>
      {compact ? (
        <Button variant="outline" size="xs" onClick={() => setOpen(true)}>
          Upload
        </Button>
      ) : (
        <PrimaryAction onClick={() => setOpen(true)}>Upload</PrimaryAction>
      )}
      {open ? <UploadDialog {...props} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

function Lightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: Media[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const m = items[index];
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") onIndex(Math.min(items.length - 1, index + 1));
      if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onIndex]);
  if (!m) return null;
  return (
    <Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-[calc(100%-2rem)] gap-3 p-3 sm:max-w-4xl">
        <DialogTitle className="sr-only">{m.caption || "Photo"}</DialogTitle>
        <div className="relative flex items-center justify-center rounded-md bg-black/80">
          <img src={m.url} alt={m.caption || "Uploaded photo"} className="max-h-[75dvh] max-w-full object-contain" />
          {index > 0 ? (
            <Button variant="secondary" size="icon-sm" className="absolute left-2" onClick={() => onIndex(index - 1)} aria-label="Previous">
              <ChevronLeft />
            </Button>
          ) : null}
          {index < items.length - 1 ? (
            <Button variant="secondary" size="icon-sm" className="absolute right-2" onClick={() => onIndex(index + 1)} aria-label="Next">
              <ChevronRight />
            </Button>
          ) : null}
        </div>
        <MediaMeta m={m} />
      </DialogContent>
    </Dialog>
  );
}

function MediaMeta({ m }: { m: Media }) {
  const who = m.user ? (m.user.github_login ? `@${m.user.github_login}` : m.user.display_name) : null;
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-1 text-xs">
      {m.caption ? <p className="text-sm break-words">{m.caption}</p> : null}
      <p className="text-muted-foreground">
        {[who, m.area_slug].filter(Boolean).join(", ")}
        {who || m.area_slug ? ", " : null}
        <time dateTime={m.created} title={formatDate(m.created)} suppressHydrationWarning>
          {relativeTime(m.created)}
        </time>
      </p>
    </div>
  );
}

/**
 * The device's uploads, newest first: images open in a lightbox, videos play
 * inline. The uploader and admins can delete. Hidden while the API has no
 * media endpoint.
 */
export function MediaGallery({
  deviceSlug,
  areaNames,
  reloadKey,
}: {
  deviceSlug: string;
  areaNames: Record<string, string>;
  reloadKey?: number;
}) {
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Media[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const known = useRef<Set<number> | null>(null);

  // Highlight an upload that was not there on the previous load.
  useEffect(() => {
    if (!items) return;
    const prev = known.current;
    known.current = new Set(items.map((m) => m.id));
    if (!prev) return;
    for (const m of items) if (!prev.has(m.id)) flash(document.querySelector(`[data-media-id="${m.id}"]`));
  }, [items]);

  const reload = useCallback(async () => {
    try {
      const res = await listMedia({ device: deviceSlug, limit: 100 });
      setItems(Array.isArray(res.media) ? res.media : []);
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 404 || err.status === 405)) setMissing(true);
      else toastError(err);
      setItems([]);
    }
  }, [deviceSlug]);
  useEffect(() => {
    void reload();
  }, [reload, reloadKey]);

  const [remove, removing] = useAction(async (id: number) => {
    if (!window.confirm("Delete this upload? This cannot be undone.")) return;
    await deleteMedia(id);
    toast.success("Upload deleted");
    await Promise.all([reload(), router.invalidate()]);
  });

  if (missing) return null;
  const images = (items ?? []).filter((m) => m.kind === "image");
  return (
    <section aria-labelledby="gallery-heading" className="flex flex-col gap-3">
      <h2 id="gallery-heading" className="text-base font-semibold">
        Photos and clips{" "}
        {items && items.length > 0 ? <span className="font-normal text-muted-foreground tabular-nums">{items.length}</span> : null}
      </h2>
      {items === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Skeleton className="aspect-[4/3]" label="Loading uploads" />
          <Skeleton className="aspect-[4/3]" label="Loading uploads" />
          <Skeleton className="hidden aspect-[4/3] sm:block" label="Loading uploads" />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-muted-foreground">No uploads yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => {
            const canDelete = !!user && (isAdmin || m.user?.id === user.id);
            return (
              <li key={m.id} data-media-id={m.id} className="group flex min-w-0 flex-col gap-1.5 rounded-lg">
                <div className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted">
                  {m.kind === "video" ? (
                    <video src={m.url} controls preload="metadata" className="h-full w-full bg-black object-contain" />
                  ) : (
                    <button
                      type="button"
                      className="block h-full w-full outline-none focus-visible:ring-3 focus-visible:ring-ring"
                      onClick={() => setOpen(images.indexOf(m))}
                      aria-label={`Open ${m.caption || "photo"}`}
                    >
                      <img src={m.url} alt={m.caption || ""} loading="lazy" className="h-full w-full object-cover" />
                    </button>
                  )}
                  {canDelete ? (
                    <Button
                      variant="secondary"
                      size="icon-sm"
                      className="absolute top-1.5 right-1.5 opacity-90"
                      onClick={() => void remove(m.id)}
                      disabled={removing}
                      aria-label={`Delete ${m.caption || "upload"}`}
                      title="Delete"
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                <MediaMeta m={{ ...m, area_slug: m.area_slug ? (areaNames[m.area_slug] ?? m.area_slug) : null }} />
              </li>
            );
          })}
        </ul>
      )}
      {open !== null ? <Lightbox items={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

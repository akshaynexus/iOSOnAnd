import { useEffect, useMemo, useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/Field";
import { useAuth } from "@/components/auth";
import { useAction } from "@/components/useAction";
import AnimatedList from "@/components/reactbits/AnimatedList";
import { useThemeMode } from "@/components/common";
import {
  FEED_PAGE,
  addPost,
  listChangelogPage,
  listPostsPage,
  type ChangelogEntry,
  type Page,
  type Post,
} from "@/lib/client";
import { formatDate, relativeTime } from "@/lib/utils";

function AddPostDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [published, setPublished] = useState("");
  const [note, setNote] = useState("");
  const [save, saving] = useAction(async () => {
    await addPost({ title: title.trim(), url: url.trim(), published: published || undefined, note });
    toast.success("Post added");
    setTitle("");
    setUrl("");
    setPublished("");
    setNote("");
    setOpen(false);
    await router.invalidate();
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    void save();
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm">Add post</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add post</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field id="post-title" label="Title">
            <Input id="post-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </Field>
          <Field id="post-url" label="URL">
            <Input
              id="post-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.reddit.com/r/..."
              required
            />
          </Field>
          <Field id="post-published" label="Published" hint="Leave empty for today">
            <Input
              id="post-published"
              type="date"
              value={published}
              onChange={(e) => setPublished(e.target.value)}
            />
          </Field>
          <Field id="post-note" label="Note">
            <Input id="post-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding" : "Add post"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Merge a fetched page into the list (by id); returns the list and how many were new. */
function merge<T extends { id: number }>(list: T[], page: T[]): [T[], number] {
  const seen = new Set(list.map((x) => x.id));
  const fresh = page.filter((x) => !seen.has(x.id));
  return [[...list, ...fresh], fresh.length];
}

/** A feed that starts with the loader's first page and loads the rest on demand. */
function usePaged<T extends { id: number }>(
  first: T[],
  firstNext: number | null,
  load: (offset: number) => Promise<Page<T>>,
) {
  const [items, setItems] = useState(first);
  const [next, setNext] = useState<number | null>(firstNext);
  useEffect(() => {
    setItems(first);
    setNext(firstNext);
  }, [first, firstNext]);
  const [more, loading] = useAction(async () => {
    if (next === null) return;
    const page = await load(next);
    const [merged, fresh] = merge(items, page.items);
    setItems(merged);
    // An API that ignores offset sends the same rows again: stop there.
    setNext(fresh === 0 ? null : page.next);
  });
  return { items, next, more, loading };
}

function MoreButton({
  shown,
  total,
  onMore,
  loading,
}: {
  shown: number;
  total?: number;
  onMore: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <Button variant="outline" onClick={onMore} disabled={loading}>
        {loading ? "Loading" : "Load more"}
      </Button>
      <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {total ? `${shown} of ${total}` : `${shown} shown`}
      </p>
    </div>
  );
}

const LIST_HEIGHT = "min(72dvh, 760px)";

export function PostsFeed({ posts, next, total }: { posts: Post[]; next: number | null; total?: number }) {
  const { canPost } = useAuth();
  const theme = useThemeMode();
  const feed = usePaged(posts, next, (offset) => listPostsPage(offset, FEED_PAGE));
  const items = useMemo(
    () =>
      feed.items.map((p) => ({
        id: p.id,
        title: p.title,
        description: p.note || undefined,
        meta: (
          <time dateTime={p.published} title={formatDate(p.published)} suppressHydrationWarning>
            {relativeTime(p.published)}
          </time>
        ),
        url: p.url,
      })),
    [feed.items],
  );
  return (
    <div className="flex flex-col gap-3">
      {canPost ? (
        <div className="flex justify-end">
          <AddPostDialog />
        </div>
      ) : null}
      {feed.items.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="font-medium">No Reddit posts tracked yet</p>
          {canPost ? null : <p className="mt-1 text-muted-foreground">Maintainers and admins add posts here.</p>}
        </div>
      ) : (
        <>
          <AnimatedList
            items={items}
            theme={theme}
            width="100%"
            maxHeight={LIST_HEIGHT}
            animation="fade"
            animateOnce
            stagger={0.03}
            onItemSelect={(item) => window.open(item.url, "_blank", "noopener,noreferrer")}
            className="updates-list"
          />
          {feed.next !== null ? (
            <MoreButton shown={feed.items.length} total={total} onMore={() => void feed.more()} loading={feed.loading} />
          ) : null}
        </>
      )}
    </div>
  );
}

export function ChangelogFeed({
  changelog,
  next,
  total,
}: {
  changelog: ChangelogEntry[];
  next: number | null;
  total?: number;
}) {
  const theme = useThemeMode();
  const feed = usePaged(changelog, next, (offset) => listChangelogPage(offset, FEED_PAGE));
  const items = useMemo(
    () =>
      feed.items.map((c) => ({
        id: c.id,
        title: c.summary,
        description: c.who || undefined,
        meta: (
          <time dateTime={c.created} title={formatDate(c.created)} suppressHydrationWarning>
            {relativeTime(c.created)}
          </time>
        ),
      })),
    [feed.items],
  );
  if (feed.items.length === 0) {
    return <p className="rounded-lg border border-dashed px-4 py-10 text-center text-muted-foreground">No changes yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <AnimatedList
        items={items}
        theme={theme}
        width="100%"
        maxHeight={LIST_HEIGHT}
        animation="fade"
        animateOnce
        stagger={0.03}
        className="updates-list"
      />
      {feed.next !== null ? (
        <MoreButton shown={feed.items.length} total={total} onMore={() => void feed.more()} loading={feed.loading} />
      ) : null}
    </div>
  );
}

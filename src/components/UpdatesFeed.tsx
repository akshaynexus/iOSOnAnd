import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useMatch, useRouter } from "@tanstack/react-router";
import {
  Activity,
  BadgeCheck,
  CircleDot,
  ExternalLink,
  GitFork,
  ListFilter,
  Newspaper,
  RefreshCw,
  Smartphone,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { InfiniteSentinel } from "@/components/InfiniteSentinel";
import { Reveal, withViewTransition } from "@/components/motion";
import { StateLabel } from "@/components/StatusBadge";
import { LinkedText, SourceLink } from "@/components/SourceLink";
import {
  FILTER_OF,
  classifyChange,
  dayKey,
  dayLabel,
  groupBy,
  parseNote,
  parseStatusChange,
  weekKey,
  weekLabel,
  type ChangeFilter,
  type ChangeKind,
  type NoteRepo,
} from "@/components/feedParse";
import {
  FEED_PAGE,
  addPost,
  listChangelogPage,
  listPostsPage,
  type AreaState,
  type ChangelogEntry,
  type Page,
  type Post,
} from "@/lib/client";
import { cn, formatDate, relativeTime } from "@/lib/utils";

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

/* ---------- Paging ---------- */

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

type Feed = { items: unknown[]; next: number | null; more: () => Promise<boolean>; loading: boolean };

/** The end of a feed: the infinite-scroll marker while more remains, else the count. */
function FeedEnd({ feed, total, paused, onResume }: { feed: Feed; total?: number; paused?: boolean; onResume?: () => void }) {
  const count = feed.items.length;
  if (feed.next === null) {
    return (
      <p className="py-2 text-center text-xs text-muted-foreground tabular-nums">
        {total && total > count ? `${count} of ${total}` : `All ${count} shown`}
      </p>
    );
  }
  if (paused) {
    return (
      <div className="flex flex-col items-center gap-1 py-2">
        <Button variant="outline" className="pointer-coarse:h-11" onClick={onResume} disabled={feed.loading}>
          {feed.loading ? "Loading" : "Load older entries"}
        </Button>
        <p className="text-xs text-muted-foreground tabular-nums">
          {count} of {total ?? count} loaded
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center">
      {feed.loading ? (
        <p className="pt-2 text-xs text-muted-foreground" aria-live="polite">
          Loading more
        </p>
      ) : null}
      <InfiniteSentinel
        count={count}
        total={total ?? count}
        onMore={() => {
          if (!feed.loading) void feed.more();
        }}
      />
    </div>
  );
}

/* ---------- Lookups from the home page's data ---------- */

interface Lookups {
  deviceName: (slug: string) => string | undefined;
  deviceByName: (name: string) => string | undefined;
  areaName: (slug: string) => string | undefined;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Device and area names from the home page's loader (empty elsewhere). */
function useLookups(): Lookups {
  const data = useMatch({ from: "/", shouldThrow: false })?.loaderData;
  const devices = data?.devices;
  const areas = data?.areas;
  return useMemo(() => {
    const names = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const d of devices ?? []) {
      names.set(d.slug, d.name);
      byName.set(norm(d.name), d.slug);
      byName.set(norm(d.slug), d.slug);
    }
    const areaNames = new Map((areas ?? []).map((a) => [a.slug, a.name]));
    return {
      deviceName: (slug) => names.get(slug),
      deviceByName: (name) => {
        const n = norm(name ?? "");
        if (!n) return undefined;
        const exact = byName.get(n);
        if (exact) return exact;
        // "Mi 10T" for "Xiaomi Mi 10T": only when exactly one device ends with it.
        const ends = (devices ?? []).filter((d) => norm(d.name).endsWith(` ${n}`));
        return ends.length === 1 ? ends[0].slug : undefined;
      },
      areaName: (slug) => areaNames.get(slug),
    };
  }, [devices, areas]);
}

/* ---------- Shared pieces ---------- */

const CHIP =
  "relative inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full border bg-background px-2 text-xs whitespace-nowrap outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-8 pointer-coarse:px-2.5 pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-1.5";

/** An inline text link with a 44px tap area on touch screens (vertical padding does not move the line). */
const INLINE_LINK = "rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-3";

function When({ value }: { value: string }) {
  return (
    <time dateTime={value} title={formatDate(value)} suppressHydrationWarning>
      {relativeTime(value) || formatDate(value)}
    </time>
  );
}

function GroupHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="px-1 text-sm font-semibold text-muted-foreground" suppressHydrationWarning>
      {children}
    </h2>
  );
}

/* ---------- Updates (Reddit posts) ---------- */

/** /api/posts sends the preview image too (migration 0007); the client type does not list it yet. */
type FeedPost = Post & { image_url?: string | null; image_width?: number | null; image_height?: number | null };

function repoHref(r: NoteRepo): string {
  const base = `https://github.com/${r.repo}`;
  return r.branch ? `${base}/tree/${r.branch.split("/").map(encodeURIComponent).join("/")}` : base;
}

function PostThumb({ post }: { post: FeedPost }) {
  const [failed, setFailed] = useState(false);
  if (!post.image_url || failed) return null;
  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={-1}
      aria-hidden
      className="block w-24 shrink-0 self-start overflow-hidden rounded-lg border bg-muted sm:w-40"
    >
      <img
        src={post.image_url}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        width={post.image_width ?? undefined}
        height={post.image_height ?? undefined}
        onError={() => setFailed(true)}
        className="aspect-[4/3] h-auto w-full object-cover"
      />
    </a>
  );
}

function PostCard({ post, look }: { post: FeedPost; look: Lookups }) {
  const note = useMemo(() => parseNote(post.note ?? "", look.deviceByName), [post.note, look]);
  const chips = note.phones.length + note.repos.length > 0;
  return (
    <article className="flex min-w-0 gap-3 rounded-[14px] border bg-card p-4 text-card-foreground sm:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="text-[15px] leading-snug font-semibold break-words">
          <a href={post.url} target="_blank" rel="noopener noreferrer" className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            {post.title}
            <ExternalLink className="ml-1 inline size-3.5 align-[-2px] text-muted-foreground" aria-hidden />
            <span className="sr-only"> (opens Reddit)</span>
          </a>
        </h3>
        {chips ? (
          <ul className="flex min-w-0 flex-wrap gap-1.5 pointer-coarse:gap-2" aria-label="Phones and repos">
            {note.phones.map((p) =>
              p.slug ? (
                <li key={`d-${p.slug}`} className="min-w-0 max-w-full">
                  <Link to="/device/$slug" params={{ slug: p.slug }} className={CHIP}>
                    <Smartphone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate">{look.deviceName(p.slug) ?? p.name}</span>
                  </Link>
                </li>
              ) : null,
            )}
            {note.repos.map((r) => (
              <li key={`r-${r.repo}-${r.branch ?? ""}`} className="min-w-0 max-w-full">
                <a
                  href={repoHref(r)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={r.branch ? `${r.repo}, branch ${r.branch}` : r.repo}
                  className={CHIP}
                >
                  <GitFork className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">
                    {r.repo}
                    {r.branch ? <span className="text-muted-foreground"> · {r.branch}</span> : null}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {note.text ? <p className="line-clamp-3 text-sm break-words text-muted-foreground">{note.text}</p> : null}
        <p className="text-xs text-muted-foreground">
          <When value={post.published} />
          {note.flair ? <span> · {note.flair}</span> : null}
        </p>
      </div>
      <PostThumb post={post} />
    </article>
  );
}

const byPublished = (a: FeedPost, b: FeedPost) => (a.published < b.published ? 1 : a.published > b.published ? -1 : 0);

export function PostsFeed({ posts, next, total }: { posts: Post[]; next: number | null; total?: number }) {
  const { canPost } = useAuth();
  const look = useLookups();
  const feed = usePaged(posts, next, (offset) => listPostsPage(offset, FEED_PAGE));
  const weeks = useMemo(
    () =>
      groupBy(feed.items as FeedPost[], (p) => weekKey(p.published)).map((g) => ({
        ...g,
        items: [...g.items].sort(byPublished),
      })),
    [feed.items],
  );
  return (
    <div className="flex max-w-3xl min-w-0 flex-col gap-6">
      {canPost ? (
        <div className="flex justify-end">
          <AddPostDialog />
        </div>
      ) : null}
      {feed.items.length === 0 ? (
        <div className="rounded-[14px] border border-dashed px-4 py-10 text-center">
          <p className="font-medium">No Reddit posts tracked yet</p>
          {canPost ? null : <p className="mt-1 text-muted-foreground">Maintainers and admins add posts here.</p>}
        </div>
      ) : (
        <>
          {weeks.map((g) => (
            <section key={g.key || "undated"} aria-labelledby={`posts-${g.key}`} className="flex min-w-0 flex-col gap-3">
              <GroupHeading id={`posts-${g.key}`}>{weekLabel(g.key)}</GroupHeading>
              <ul className="flex min-w-0 flex-col gap-3">
                {g.items.map((p) => (
                  <Reveal as="li" key={p.id} className="min-w-0">
                    <PostCard post={p} look={look} />
                  </Reveal>
                ))}
              </ul>
            </section>
          ))}
          <FeedEnd feed={feed} total={total} />
        </>
      )}
    </div>
  );
}

/* ---------- Changelog ---------- */

const KIND_ICON: Record<ChangeKind, LucideIcon> = {
  status: Activity,
  device: Smartphone,
  repo: GitFork,
  claim: BadgeCheck,
  sync: RefreshCw,
  post: Newspaper,
  account: UserRound,
  other: CircleDot,
};

const KIND_LABEL: Record<ChangeKind, string> = {
  status: "Status change",
  device: "Device change",
  repo: "Repo change",
  claim: "Claim",
  sync: "Sync",
  post: "Reddit post",
  account: "Account",
  other: "Change",
};

const FILTERS: Array<[ChangeFilter, string, LucideIcon]> = [
  ["all", "All", ListFilter],
  ["status", "Status", Activity],
  ["device", "Devices", Smartphone],
  ["repo", "Repos", GitFork],
  ["claim", "Claims", BadgeCheck],
  ["sync", "Syncs", RefreshCw],
];

const EMPTY_FILTER: Record<ChangeFilter, string> = {
  all: "No changes yet.",
  status: "No status changes loaded yet.",
  device: "No device changes loaded yet.",
  repo: "No repo changes loaded yet.",
  claim: "No claims loaded yet.",
  sync: "No syncs loaded yet.",
};

function matches(filter: ChangeFilter, c: ChangelogEntry): boolean {
  return filter === "all" || FILTER_OF[classifyChange(c.summary)] === filter;
}

function FilterBar({ value, onChange }: { value: ChangeFilter; onChange: (f: ChangeFilter) => void }) {
  return (
    <div role="group" aria-label="Show" className="grid grid-cols-3 rounded-md border p-0.5 sm:inline-flex sm:self-start">
      {FILTERS.map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11 pointer-coarse:px-3",
            value === v ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

const TOKEN = /(https?:\/\/[^\s),]+)|([A-Za-z0-9][\w.-]*\/[A-Za-z0-9_.-]*[A-Za-z0-9_-])|([a-z0-9][a-z0-9-]*)/g;

/** A summary with its URLs, repos and tracked device slugs as links; the rest as text. */
function RichSummary({ text, kind, look }: { text: string; kind: ChangeKind; look: Lookups }) {
  const out: ReactNode[] = [];
  let last = 0;
  const linkRepos = kind === "repo" || kind === "claim" || kind === "sync";
  const linkDevices = kind !== "post" && kind !== "account";
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    let node: ReactNode = null;
    if (m[1]) node = <SourceLink source={m[1]} />;
    else if (m[2] && linkRepos && !/^r\//i.test(m[2]) && !/\(s\)$/.test(m[2])) {
      node = (
        <a href={`https://github.com/${m[2]}`} target="_blank" rel="noopener noreferrer" className={cn(INLINE_LINK, "break-all")}>
          {m[2]}
        </a>
      );
    } else if (m[3] && linkDevices && at > 0 && look.deviceName(m[3]) && !/^device \S+ removed/.test(text)) {
      node = (
        <Link to="/device/$slug" params={{ slug: m[3] }} title={look.deviceName(m[3])} className={INLINE_LINK}>
          {m[3]}
        </Link>
      );
    }
    if (!node) continue;
    if (at > last) out.push(text.slice(last, at));
    out.push(<Fragment key={at}>{node}</Fragment>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <p className="min-w-0 text-sm break-words">{out}</p>;
}

function ChangeBody({ entry, kind, look }: { entry: ChangelogEntry; kind: ChangeKind; look: Lookups }) {
  const st = kind === "status" ? parseStatusChange(entry.summary) : null;
  if (!st) return <RichSummary text={entry.summary} kind={kind} look={look} />;
  const name = look.deviceName(st.device);
  return (
    <>
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <Link to="/device/$slug" params={{ slug: st.device }} className={cn(INLINE_LINK, "min-w-0 break-words")}>
          {name ?? st.device}
        </Link>
        <span className="text-muted-foreground">{look.areaName(st.area) ?? st.area}</span>
        <StateLabel state={st.state as AreaState} className="text-sm" />
      </p>
      {st.detail ? (
        <p className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-sm break-words text-muted-foreground">
          <LinkedText text={st.detail} />
        </p>
      ) : null}
    </>
  );
}

function ChangeRow({ entry, look }: { entry: ChangelogEntry; look: Lookups }) {
  const kind = classifyChange(entry.summary);
  const Icon = KIND_ICON[kind];
  return (
    <div className="flex min-w-0 items-start gap-3 px-4 py-3">
      <span
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
        title={KIND_LABEL[kind]}
      >
        <Icon className="size-4" aria-hidden />
        <span className="sr-only">{KIND_LABEL[kind]}</span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ChangeBody entry={entry} kind={kind} look={look} />
        <p className="text-xs text-muted-foreground">
          {entry.who ? <span className="break-all">{entry.who}</span> : null}
          {entry.who ? " · " : null}
          <When value={entry.created} />
        </p>
      </div>
    </div>
  );
}

/** Pages in a row that brought nothing for the filter before auto-loading stops. */
const MAX_MISSES = 8;

export function ChangelogFeed({
  changelog,
  next,
  total,
}: {
  changelog: ChangelogEntry[];
  next: number | null;
  total?: number;
}) {
  const look = useLookups();
  const feed = usePaged(changelog, next, (offset) => listChangelogPage(offset, FEED_PAGE));
  const [filter, setFilter] = useState<ChangeFilter>("all");
  const shown = useMemo(() => feed.items.filter((c) => matches(filter, c)), [feed.items, filter]);
  const days = useMemo(() => groupBy(shown, (c) => dayKey(c.created)), [shown]);

  // A rare filter would page through the whole log: after a few pages that
  // add nothing it waits for a click instead.
  const [misses, setMisses] = useState(0);
  const seen = useRef({ items: feed.items.length, shown: shown.length, filter });
  useEffect(() => {
    const prev = seen.current;
    seen.current = { items: feed.items.length, shown: shown.length, filter };
    if (prev.filter !== filter) setMisses(0);
    else if (feed.items.length > prev.items) setMisses((n) => (shown.length > prev.shown ? 0 : n + 1));
  }, [feed.items.length, shown.length, filter]);
  const paused = filter !== "all" && misses >= MAX_MISSES;

  if (feed.items.length === 0) {
    return <p className="max-w-3xl rounded-[14px] border border-dashed px-4 py-10 text-center text-muted-foreground">No changes yet.</p>;
  }
  return (
    <div className="flex max-w-3xl min-w-0 flex-col gap-6">
      <FilterBar value={filter} onChange={(f) => withViewTransition(() => setFilter(f))} />
      {days.length === 0 ? (
        <p className="rounded-[14px] border border-dashed px-4 py-10 text-center text-muted-foreground">{EMPTY_FILTER[filter]}</p>
      ) : (
        days.map((g) => (
          <section
            key={g.key || "undated"}
            aria-labelledby={`changes-${g.key}`}
            className="flex min-w-0 flex-col gap-3"
          >
            <GroupHeading id={`changes-${g.key}`}>{dayLabel(g.key)}</GroupHeading>
            <ul className="min-w-0 divide-y overflow-hidden rounded-[14px] border bg-card text-card-foreground">
              {g.items.map((c) => (
                <Reveal as="li" key={c.id} className="min-w-0">
                  <ChangeRow entry={c} look={look} />
                </Reveal>
              ))}
            </ul>
          </section>
        ))
      )}
      <FeedEnd
        feed={feed}
        total={total}
        paused={paused}
        onResume={() => {
          setMisses(0);
          void feed.more();
        }}
      />
    </div>
  );
}

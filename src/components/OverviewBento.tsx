import { useMemo } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import MagicBento, { type MagicBentoItem } from "@/components/reactbits/MagicBento";
import { useThemeMode } from "@/components/common";
import { CountUp } from "@/components/motion";
import { familiesOfDevice, familyName, forksByRepo } from "@/components/repoInfo";
import { boots, stateCounts, applicableAreas } from "@/lib/areas";
import { forkKind, forkMaintainer, type Dashboard, type Media } from "@/lib/client";
import { formatDate, parseDate, relativeTime } from "@/lib/utils";

function Card({ label, children, foot }: { label: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="magic-bento__header">
        <span className="magic-bento__label">{label}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center">{children}</div>
      {foot ? <div className="truncate text-xs text-(--mb-muted)">{foot}</div> : null}
    </div>
  );
}

function Big({ value, sub }: { value: ReactNode; sub?: ReactNode }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-4xl leading-none font-semibold tracking-tight text-(--mb-ink) tabular-nums">
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </span>
      {sub ? <span className="text-sm text-(--mb-muted) tabular-nums">{sub}</span> : null}
    </p>
  );
}

/** Horizontal bars with the name and count on each row. */
function Bars({ rows }: { rows: [string, number][] }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map(([name, n]) => (
        <li key={name} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate text-(--mb-ink)">{name}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-[rgba(var(--mb-glow-rgb),0.1)]">
            <span
              className="block h-full rounded-full bg-[rgba(var(--mb-glow-rgb),0.6)]"
              style={{ width: `${(n / max) * 100}%` }}
            />
          </span>
          <span className="text-(--mb-muted) tabular-nums">{n}</span>
        </li>
      ))}
    </ul>
  );
}

/** The Overview summary: real numbers from the dashboard, in a React Bits MagicBento grid. */
export function OverviewBento({ data }: { data: Dashboard }) {
  const theme = useThemeMode();
  const navigate = useNavigate();

  const items = useMemo<MagicBentoItem[]>(() => {
    const { devices, areas, forks, posts } = data;
    const booting = devices.filter(boots).length;

    // Best OneiOS result: the OneiOS-based phone with the most working areas
    // (any phone while the API has no base field yet).
    const pool = devices.some((d) => d.base === "oneios") ? devices.filter((d) => d.base === "oneios") : devices;
    let best: { name: string; slug: string; works: number; of: number; text: string } | null = null;
    for (const d of pool) {
      const c = stateCounts(d, areas);
      if (!best || c.works > best.works) {
        best = { name: d.name, slug: d.slug, works: c.works, of: applicableAreas(d, areas).length, text: d.best_result };
      }
    }

    const oneios = devices.filter((d) => d.base === "oneios").length;
    // Ports by family: each phone counted once, under its main family.
    const byRepo = forksByRepo(forks);
    const families = new Map<string, number>();
    for (const d of devices) {
      const fam = familiesOfDevice(d, byRepo)[0];
      if (fam && fam !== "unknown") families.set(fam, (families.get(fam) ?? 0) + 1);
    }
    const familyRows: [string, number][] = [...families.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([k, n]) => [familyName(k), n]);
    const maintained = forks.filter((f) => forkMaintainer(f)).length;
    // Same split as the Repos tab: main repos (upstream, standalone) and forks.
    const mainRepos = forks.filter((f) => forkKind(f) !== "fork").length;

    const post = posts[0];
    const uploads: (Media & { device_name: string })[] = devices
      .filter((d) => d.latest_media)
      .map((d) => ({ ...(d.latest_media as Media), device_name: d.name }))
      .sort((a, b) => (parseDate(b.created)?.getTime() ?? 0) - (parseDate(a.created)?.getTime() ?? 0));
    const mediaTotal = devices.reduce((n, d) => n + (d.media_count ?? 0), 0);

    return [
      {
        id: "phones",
        title: "Phones",
        content: (
          <Card label="Phones">
            <Big value={devices.length} sub={booting > 0 ? `${booting} boot to Home Screen` : undefined} />
          </Card>
        ),
      },
      {
        id: "best",
        title: best ? `Best result: ${best.name}` : "Best result",
        colSpan: 2,
        onClick: best ? () => void navigate({ to: "/device/$slug", params: { slug: best.slug } }) : undefined,
        content: (
          <Card label={oneios > 0 ? "Best OneiOS result" : "Best result"} foot={best?.text || undefined}>
            {best && best.works > 0 ? (
              <>
                <Big value={best.works} sub={`of ${best.of} areas work`} />
                <p className="mt-1 truncate text-sm font-medium text-(--mb-ink)">{best.name}</p>
              </>
            ) : (
              <p className="text-sm text-(--mb-muted)">No working areas reported yet.</p>
            )}
          </Card>
        ),
      },
      {
        id: "bases",
        title: "Ports by family",
        onClick: () => void navigate({ to: "/", search: { tab: "repos" } }),
        content: (
          <Card label="Ports by family">
            {familyRows.length > 0 ? (
              <Bars rows={familyRows} />
            ) : (
              <p className="text-sm text-(--mb-muted)">No lineage recorded yet.</p>
            )}
          </Card>
        ),
      },
      {
        id: "repos",
        title: "Repos",
        onClick: () => void navigate({ to: "/", search: { tab: "repos" } }),
        content: (
          <Card
            label="Repos"
            foot={`${mainRepos} main, ${forks.length - mainRepos} forks and ports${maintained > 0 ? `; ${maintained} with a maintainer` : ""}`}
          >
            <Big value={forks.length} />
          </Card>
        ),
      },
      {
        id: "reddit",
        title: post ? `Newest Reddit post: ${post.title}` : "Newest Reddit post",
        colSpan: 2,
        href: post?.url,
        target: "_blank",
        rel: "noopener noreferrer",
        content: (
          <Card
            label="Newest Reddit post"
            foot={post?.published ? <time dateTime={post.published} title={formatDate(post.published)} suppressHydrationWarning>{relativeTime(post.published)}</time> : undefined}
          >
            {post ? (
              <>
                <p className="line-clamp-2 text-base leading-snug font-medium text-(--mb-ink)">{post.title}</p>
                {post.note ? <p className="mt-1 line-clamp-1 text-sm text-(--mb-muted)">{post.note}</p> : null}
              </>
            ) : (
              <p className="text-sm text-(--mb-muted)">No posts tracked yet.</p>
            )}
          </Card>
        ),
      },
      {
        id: "uploads",
        title: "Newest uploads",
        onClick: uploads[0]
          ? () => void navigate({ to: "/device/$slug", params: { slug: uploads[0].device_slug } })
          : undefined,
        content: (
          <Card
            label="Newest uploads"
            foot={uploads[0] ? `${uploads[0].device_name}, ${relativeTime(uploads[0].created)}` : undefined}
          >
            {uploads.length > 0 ? (
              <div className="flex items-center gap-2">
                {uploads.slice(0, 3).map((m) => (
                  <img
                    key={m.id}
                    src={m.url}
                    alt={m.caption || m.device_name}
                    loading="lazy"
                    className="size-14 rounded-lg object-cover"
                  />
                ))}
                {mediaTotal > 3 ? <span className="text-xs text-(--mb-muted) tabular-nums">{mediaTotal} in all</span> : null}
              </div>
            ) : (
              <p className="text-sm text-(--mb-muted)">No photos or clips uploaded yet.</p>
            )}
          </Card>
        ),
      },
    ];
  }, [data, navigate]);

  return (
    <MagicBento
      items={items}
      columns={4}
      rowHeight={148}
      gap={12}
      radius={16}
      theme={theme}
      enableBorderGlow
      enableSpotlight
      spotlightRadius={240}
      clickEffect={false}
      textAutoHide
      className="overview-bento"
    />
  );
}

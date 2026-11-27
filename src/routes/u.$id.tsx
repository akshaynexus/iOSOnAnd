// /u/$id — a public profile: who they are on GitHub, the phones and repos
// they maintain at a glance, and their recent status changes. Never the email.
import { useEffect } from "react";
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { ArrowRight, ExternalLink } from "lucide-react";
import { RouteError, RoutePending } from "@/components/Page";
import { PhoneOutline } from "@/components/common";
import { StateLabel } from "@/components/StatusBadge";
import { LinkedText } from "@/components/SourceLink";
import { CountUp } from "@/components/motion";
import { OS_LABELS, loadUserProfile, profileParam, trackHit, type AreaState, type Os, type UserProfile } from "@/lib/client";
import { formatDate, relativeTime } from "@/lib/utils";
import { seo } from "@/lib/seo";

export const Route = createFileRoute("/u/$id")({
  loader: async ({ params }) => {
    const user = await loadUserProfile({ data: params.id });
    if (!user) throw notFound();
    // One address per person: /u/<GitHub login> when linked (old numeric links redirect there).
    const canonical = profileParam(user);
    if (params.id !== canonical) throw redirect({ to: "/u/$id", params: { id: canonical }, replace: true, statusCode: 301 });
    return user;
  },
  head: ({ loaderData }) =>
    seo({
      title: loaderData ? `${name(loaderData)} on iOSOnAnd` : "Profile: iOSOnAnd",
      description: loaderData
        ? `${name(loaderData)} maintains ${loaderData.devices.length} phone${loaderData.devices.length === 1 ? "" : "s"} and ${loaderData.repos.length} repo${loaderData.repos.length === 1 ? "" : "s"} on the iOSOnAnd tracker.`
        : undefined,
      path: loaderData ? `/u/${profileParam(loaderData)}` : undefined,
    }),
  component: ProfileView,
  errorComponent: RouteError,
  pendingComponent: RoutePending,
  notFoundComponent: () => (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">No such user</h1>
      <Link to="/" className="text-muted-foreground underline underline-offset-4">
        All phones
      </Link>
    </div>
  ),
});

function name(u: Pick<UserProfile, "display_name" | "github_login" | "id">): string {
  return u.display_name || (u.github_login ? `@${u.github_login}` : `user #${u.id}`);
}

const CARD = "rounded-[14px] border bg-card text-card-foreground";

function Avatar({ u }: { u: UserProfile }) {
  if (!u.github_login) {
    return (
      <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl border bg-muted text-2xl font-semibold text-muted-foreground sm:size-20">
        {name(u).replace(/^@/, "").charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={`https://github.com/${encodeURIComponent(u.github_login)}.png?size=160`}
      alt=""
      className="size-16 shrink-0 rounded-2xl border bg-muted object-cover sm:size-20"
    />
  );
}

function ProfileView() {
  const u = Route.useLoaderData();
  useEffect(() => trackHit("profile_view", String(u.id)), [u.id]);
  const joined = u.created ? new Date(u.created.replace(" ", "T")).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const stats: Array<[string, number]> = [
    ["Phones", u.devices.length],
    ["Repos", u.repos.length],
    ["Status changes", u.recent.length >= 20 ? 20 : u.recent.length],
    ["Features", u.features],
    ...(u.views ? ([["Views this month", u.views.d30]] as Array<[string, number]>) : []),
  ];
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="flex items-center gap-4">
        <Avatar u={u} />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight break-words">{name(u)}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {u.github_login ? (
              <a href={`https://github.com/${u.github_login}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                @{u.github_login}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : (
              <span>GitHub not linked</span>
            )}
            {joined ? <span suppressHydrationWarning>Joined {joined}</span> : null}
          </p>
        </div>
      </header>

      <dl className={`${CARD} grid grid-cols-2 divide-x divide-y sm:divide-y-0 ${stats.length > 4 ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
        {stats.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 px-4 py-3">
            <dt className="text-xs text-muted-foreground">{label === "Status changes" && u.recent.length >= 20 ? "Recent changes" : label}</dt>
            <dd>
              <CountUp value={value} className="text-xl font-semibold tabular-nums" />
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="phones-heading" className="flex flex-col gap-3">
        <h2 id="phones-heading" className="text-base font-semibold">
          Phones they maintain
        </h2>
        {u.devices.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {u.devices.map((d) => (
              <li key={d.slug} className="min-w-0">
                <Link
                  to="/device/$slug"
                  params={{ slug: d.slug }}
                  className={`${CARD} flex min-w-0 items-center gap-3 p-3 outline-none transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring`}
                >
                  <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/50">
                    {d.image_url ? (
                      <img src={d.image_url} alt="" loading="lazy" className="max-h-full max-w-full object-contain p-0.5" />
                    ) : (
                      <PhoneOutline className="h-3/5 w-auto text-muted-foreground opacity-60" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{d.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{d.ios_version || d.soc}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {d.works} areas work{d.boots ? " · boots to Home" : ""}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No phones yet.</p>
        )}
      </section>

      {u.repos.length ? (
        <section aria-labelledby="repos-heading" className="flex flex-col gap-3">
          <h2 id="repos-heading" className="text-base font-semibold">
            Repos they maintain
          </h2>
          <ul className={`${CARD} flex flex-col divide-y overflow-hidden`}>
            {u.repos.map((r) => (
              <li key={r.id} className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
                <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <a href={`https://github.com/${r.repo}`} target="_blank" rel="noopener noreferrer" className="font-mono text-sm break-all hover:underline">
                    {r.repo}
                  </a>
                  {r.base_project ? <span className="text-xs text-muted-foreground">{r.base_project}</span> : null}
                  {r.device_slug ? (
                    <Link to="/device/$slug" params={{ slug: r.device_slug }} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                      {u.devices.find((d) => d.slug === r.device_slug)?.name ?? r.device_slug}
                    </Link>
                  ) : null}
                </p>
                {r.best_result ? <p className="line-clamp-2 text-sm text-muted-foreground">{r.best_result}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {u.recent.length ? (
        <section aria-labelledby="recent-heading" className="flex flex-col gap-3">
          <h2 id="recent-heading" className="text-base font-semibold">
            Recent changes
          </h2>
          <ul className={`${CARD} flex flex-col divide-y overflow-hidden`}>
            {u.recent.map((c) => (
              <li key={c.id} className="grid min-w-0 gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <Link to="/device/$slug" params={{ slug: c.device_slug }} className="font-medium hover:underline">
                      {u.devices.find((d) => d.slug === c.device_slug)?.name ?? c.device_slug}
                    </Link>
                    <span className="text-muted-foreground">{c.area_name ?? c.area_slug}</span>
                    {c.os && c.os !== "ios" ? <span className="text-xs text-muted-foreground">{OS_LABELS[c.os as Os] ?? c.os}</span> : null}
                    <span className="inline-flex items-center gap-1.5">
                      {c.old_state ? (
                        <>
                          <StateLabel state={c.old_state as AreaState} className="opacity-70" />
                          <ArrowRight className="size-3.5 text-muted-foreground" aria-label="to" />
                        </>
                      ) : null}
                      <StateLabel state={c.state as AreaState} />
                    </span>
                  </p>
                  {c.detail ? (
                    <p className="line-clamp-2 text-sm break-words text-muted-foreground">
                      <LinkedText text={c.detail} />
                    </p>
                  ) : null}
                </div>
                <time dateTime={c.created} title={formatDate(c.created)} suppressHydrationWarning className="text-xs text-muted-foreground sm:text-right">
                  {relativeTime(c.created)}
                </time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

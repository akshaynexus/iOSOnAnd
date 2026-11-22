import { useMemo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/Page";
import { useAuth } from "@/components/auth";
import { DeviceBrowser } from "@/components/DeviceBrowser";
import { OverviewBento } from "@/components/OverviewBento";
import { CompatMatrix } from "@/components/CompatMatrix";
import { MainRepos, ReposTable } from "@/components/ReposTable";
import { MaintainPanel } from "@/components/RepoClaim";
import { LineageTree } from "@/components/LineageTree";
import { ChangelogFeed, PostsFeed } from "@/components/UpdatesFeed";
import { deviceMatches, forkMatches } from "@/lib/areas";
import { forkKind, loadDashboard } from "@/lib/client";

const TABS = ["overview", "compatibility", "repos", "updates", "changelog"] as const;
type Tab = (typeof TABS)[number];

interface HomeSearch {
  q?: string;
  tab?: Tab;
  /** Repos tab: a device slug, or "none" for forks with no device. */
  device?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    const out: HomeSearch = {};
    if (typeof search.q === "string" && search.q.trim()) out.q = search.q;
    if (typeof search.tab === "string" && (TABS as readonly string[]).includes(search.tab) && search.tab !== "overview") {
      out.tab = search.tab as Tab;
    }
    if (typeof search.device === "string" && search.device) out.device = search.device;
    return out;
  },
  loader: () => loadDashboard(),
  component: HomePage,
  errorComponent: RouteError,
  pendingComponent: RoutePending,
});

const TITLES: Record<Tab, string> = {
  overview: "iOS on Android phones",
  compatibility: "Compatibility",
  repos: "Repos",
  updates: "Updates from Reddit",
  changelog: "Changelog",
};

function HomePage() {
  const data = Route.useLoaderData();
  const { q = "", tab = "overview", device } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const { canEdit } = useAuth();
  const query = q.trim();

  const deviceNames = useMemo(
    () => Object.fromEntries(data.devices.map((d) => [d.slug, d.name])),
    [data.devices],
  );
  const deviceList = useMemo(() => data.devices.map((d) => ({ slug: d.slug, name: d.name })), [data.devices]);
  const shown = useMemo(
    () => (query ? data.devices.filter((d) => deviceMatches(d, query)) : data.devices),
    [data.devices, query],
  );
  const forks = useMemo(
    () =>
      query
        ? data.forks.filter((f) => forkMatches(f, f.device_slug ? (deviceNames[f.device_slug] ?? "") : "", query))
        : data.forks,
    [data.forks, deviceNames, query],
  );
  const plainForks = useMemo(() => forks.filter((f) => forkKind(f) === "fork"), [forks]);

  const clearSearch = () => void navigate({ search: (s) => ({ ...s, q: undefined }), replace: true });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">{TITLES[tab]}</h1>
        {tab === "overview" ? (
          <p className="text-muted-foreground">What works on each phone that runs iOS through OneiOS or another port, area by area.</p>
        ) : null}
      </div>

      {query ? (
        <div className="-mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          <span>
            Showing matches for <span className="font-medium text-foreground">"{query}"</span>
          </span>
          <button type="button" onClick={clearSearch} className="text-brand hover:underline">
            Clear
          </button>
        </div>
      ) : null}

      <div key={tab} className="tab-fade flex flex-col gap-6">
      {tab === "overview" ? (
        <div className="flex flex-col gap-8">
          {query ? null : <OverviewBento data={data} />}
          <DeviceBrowser
            devices={shown}
            areas={data.areas}
            forks={data.forks}
            emptyText={data.devices.length === 0 ? "No phones tracked yet." : `No phones match "${query}".`}
          />
          <MaintainPanel devices={deviceList} short />
        </div>
      ) : null}

      {tab === "compatibility" ? (
        <section aria-label="Compatibility">
          <CompatMatrix areas={data.areas} devices={shown} />
        </section>
      ) : null}

      {tab === "repos" ? (
        <div className="flex flex-col gap-8">
          <MaintainPanel devices={deviceList} />
          <MainRepos forks={forks} deviceNames={deviceNames} areas={data.areas} />
          <section aria-labelledby="forks-heading" className="flex flex-col gap-3">
            <h2 id="forks-heading" className="text-base font-semibold">
              Forks and ports <span className="font-normal text-muted-foreground tabular-nums">{plainForks.length}</span>
            </h2>
            <ReposTable
              forks={plainForks}
              deviceNames={deviceNames}
              deviceFilter={device}
              onDeviceFilter={(slug) => void navigate({ search: (s) => ({ ...s, device: slug }), replace: true })}
              canEdit={canEdit}
              areas={data.areas}
              emptyText={query ? `No repos match "${query}".` : "No forks tracked yet."}
            />
          </section>
          <LineageTree />
        </div>
      ) : null}

      {tab === "updates" ? (
        <section aria-label="Updates">
          <PostsFeed posts={data.posts} next={data.postsNext} total={data.postsTotal} />
        </section>
      ) : null}

      {tab === "changelog" ? (
        <section aria-label="Changelog">
          <ChangelogFeed changelog={data.changelog} next={data.changelogNext} total={data.changelogTotal} />
        </section>
      ) : null}
      </div>
    </div>
  );
}

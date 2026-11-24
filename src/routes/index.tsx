import { useEffect, useMemo, useState } from "react";
import { LayoutList, Network } from "lucide-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RouteError, RoutePending } from "@/components/Page";
import { useAuth } from "@/components/auth";
import { DeviceBrowser } from "@/components/DeviceBrowser";
import { OverviewSummary } from "@/components/OverviewSummary";
import { CompatMatrix } from "@/components/CompatMatrix";
import { MainRepos, ReposTable } from "@/components/ReposTable";
import { ReposByBase } from "@/components/ReposByBase";
import { YourReposToClaim } from "@/components/ClaimCallout";
import { cn } from "@/lib/utils";
import { AddPhoneOrRepo, MaintainPanel, PortIosButton } from "@/components/RepoClaim";
import { LineageTree } from "@/components/LineageTree";
import { familyOfFork } from "@/components/repoInfo";
import { FindReferences, ProjectsSection, StartCards, projectOfFamily } from "@/components/ProjectsSection";
import { PROJECTS } from "@/lib/projects";
import { ChangelogFeed, PostsFeed } from "@/components/UpdatesFeed";
import { deviceMatches, forkMatches } from "@/lib/areas";
import { forkKind, loadDashboard } from "@/lib/client";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, jsonLd, seo } from "@/lib/seo";

const TABS = ["overview", "compatibility", "repos", "updates", "changelog"] as const;
type Tab = (typeof TABS)[number];

interface HomeSearch {
  q?: string;
  tab?: Tab;
  /** Repos tab: a device slug, or "none" for forks with no device. */
  device?: string;
  /**
   * Overview: the phone grid's family filter (a family key, or "none" for phones with no repo).
   * Repos: the repos' family ("Based on"); a project's family opens that project.
   */
  family?: string;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => {
    const out: HomeSearch = {};
    if (typeof search.q === "string" && search.q.trim()) out.q = search.q;
    if (typeof search.tab === "string" && (TABS as readonly string[]).includes(search.tab) && search.tab !== "overview") {
      out.tab = search.tab as Tab;
    }
    if (typeof search.device === "string" && search.device) out.device = search.device;
    if (typeof search.family === "string" && search.family) out.family = search.family;
    return out;
  },
  loader: () => loadDashboard(),
  head: ({ match }) => ({
    ...(match.search.tab === "repos"
      ? seo({
          title: "Projects and repos: how each iOS-on-Android port works",
          description:
            "OneiOS, HackiOS, ios-sweet, UniXNU and the other projects iOS-on-Android ports start from: how each boots, what works, and every repo and fork built on them.",
          path: "/?tab=repos",
        })
      : seo({ title: "iOSOnAnd: which Android phones run iOS", description: SITE_DESCRIPTION, path: "/" })),
    scripts: [
      jsonLd({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        potentialAction: {
          "@type": "SearchAction",
          target: `${SITE_URL}/?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      }),
    ],
  }),
  component: HomePage,
  errorComponent: RouteError,
  pendingComponent: RoutePending,
});

const TITLES: Record<Tab, string> = {
  overview: "iOS on Android phones",
  compatibility: "Compatibility",
  repos: "Projects and repos",
  updates: "Updates from Reddit",
  changelog: "Changelog",
};

type RepoView = "base" | "list";
const REPO_VIEW_KEY = "iosonand.repos.view";

/** "By base" (forks under the repo they come from) or "List" (one table). */
function RepoViewToggle({ view, onChange }: { view: RepoView; onChange: (v: RepoView) => void }) {
  const SEG =
    "inline-flex h-7 items-center gap-1.5 rounded px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10 pointer-coarse:px-3";
  return (
    <div role="group" aria-label="Repos view" className="inline-flex rounded-md border p-0.5">
      {(
        [
          ["base", "By base", Network],
          ["list", "List", LayoutList],
        ] as const
      ).map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={cn(SEG, view === v ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

function HomePage() {
  const data = Route.useLoaderData();
  const { q = "", tab = "overview", device, family = "" } = Route.useSearch();
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

  const project = tab === "repos" ? projectOfFamily(family) : undefined;
  const [repoView, setRepoViewState] = useState<RepoView>("base");
  useEffect(() => {
    try {
      if (localStorage.getItem(REPO_VIEW_KEY) === "list") setRepoViewState("list");
    } catch {
      /* no storage: the default view */
    }
  }, []);
  const setRepoView = (v: RepoView) => {
    setRepoViewState(v);
    try {
      localStorage.setItem(REPO_VIEW_KEY, v);
    } catch {
      /* not remembered */
    }
  };
  const setFamily = (key: string) =>
    void navigate({ search: (s) => ({ ...s, family: key || undefined }), replace: true, resetScroll: false });

  const clearSearch = () => void navigate({ search: (s) => ({ ...s, q: undefined }), replace: true });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{TITLES[tab]}</h1>
          {tab === "overview" || tab === "repos" ? (
            <div className="flex flex-wrap items-center gap-2">
              <PortIosButton />
              <AddPhoneOrRepo devices={deviceList} />
            </div>
          ) : null}
        </div>
        {tab === "overview" ? (
          <p className="text-muted-foreground">What works on each phone that runs iOS through OneiOS or another port, area by area.</p>
        ) : null}
        {tab === "repos" ? (
          <p className="text-muted-foreground">
            Every port starts from one of these projects. How each boots says a lot about what can work on your phone.
          </p>
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
          <YourReposToClaim forks={data.forks} devices={data.devices} />
          {query ? null : <OverviewSummary data={data} family={family} onFamily={setFamily} />}
          <DeviceBrowser
            devices={shown}
            family={family}
            onFamilyChange={setFamily}
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
          <YourReposToClaim forks={data.forks} devices={data.devices} />
          {query ? null : (
            <ProjectsSection
              devices={data.devices}
              forks={data.forks}
              areas={data.areas}
              selected={project?.id}
              onSelect={(id) => setFamily(PROJECTS.find((p) => p.id === id)?.family ?? "")}
            />
          )}
          {project ? null : <StartCards maintain={<MaintainPanel devices={deviceList} />} />}
          <section aria-labelledby="repos-heading" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="repos-heading" className="text-base font-semibold">
                {project ? `${project.name} repos` : "Repos"}{" "}
                <span className="font-normal text-muted-foreground tabular-nums">
                  {family ? forks.filter((f) => (familyOfFork(f) ?? "").toLowerCase() === family.toLowerCase()).length : forks.length}
                </span>
              </h2>
              <RepoViewToggle view={repoView} onChange={setRepoView} />
            </div>
            {repoView === "base" ? (
              <ReposByBase
                forks={forks}
                all={data.forks}
                devices={data.devices}
                deviceNames={deviceNames}
                areas={data.areas}
                canEdit={canEdit}
                family={family}
                onFamily={setFamily}
                device={device}
                onDevice={(slug) => void navigate({ search: (s) => ({ ...s, device: slug }), replace: true, resetScroll: false })}
              />
            ) : (
              <>
                <MainRepos forks={forks} deviceNames={deviceNames} areas={data.areas} family={family || undefined} />
                <section aria-labelledby="forks-heading" className="flex flex-col gap-3">
                  <h3 id="forks-heading" className="text-base font-semibold">
                    Forks and ports{" "}
                    <span className="font-normal text-muted-foreground tabular-nums">
                      {project ? plainForks.filter((f) => (familyOfFork(f) ?? "").toLowerCase() === project.family.toLowerCase()).length : plainForks.length}
                    </span>
                  </h3>
                  <ReposTable
                    forks={plainForks}
                    deviceNames={deviceNames}
                    deviceFilter={device}
                    onDeviceFilter={(slug) => void navigate({ search: (s) => ({ ...s, device: slug }), replace: true })}
                    familyFilter={family}
                    onFamilyFilter={setFamily}
                    canEdit={canEdit}
                    areas={data.areas}
                    emptyText={query ? `No repos match "${query}".` : "No forks tracked yet."}
                  />
                </section>
              </>
            )}
          </section>
          {project ? <StartCards maintain={<MaintainPanel devices={deviceList} />} /> : null}
          <LineageTree />
          <FindReferences />
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

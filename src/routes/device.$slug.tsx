import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { RouteError, RoutePending } from "@/components/Page";
import { useAuth } from "@/components/auth";
import { StateLabel, StatusBar } from "@/components/StatusBadge";
import { AreaTable } from "@/components/AreaTable";
import { ForkDialog } from "@/components/ForkDialog";
import { ClaimPanel } from "@/components/ClaimPanel";
import { BasedOnChips, ReposTable, forkHref } from "@/components/ReposTable";
import { MediaGallery, UploadButton } from "@/components/Media";
import { devicePhoto } from "@/components/DeviceCard";
import { PhoneOutline } from "@/components/common";
import { ONEIOS_REPO, familiesOfDevice, supportPhrase, supportersOf } from "@/components/repoInfo";
import { FamilyChip } from "@/components/DeviceCard";
import { applicableAreas, applies, entryFor, stateCounts } from "@/lib/areas";
import { loadDevice, maintainersOf, type Area, type Device, type Fork } from "@/lib/client";
import { LinkedText } from "@/components/SourceLink";
import { formatDate, relativeTime, vtName } from "@/lib/utils";

export const Route = createFileRoute("/device/$slug")({
  loader: async ({ params }) => {
    const res = await loadDevice({ data: params.slug });
    if (!res.device) throw notFound();
    return res as { device: Device; areas: Area[] };
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.device.name}: iOSOnAnd` },
          { name: "description", content: loaderData.device.best_result || loaderData.device.notes },
        ]
      : [],
  }),
  component: DevicePage,
  errorComponent: RouteError,
  pendingComponent: RoutePending,
  notFoundComponent: DeviceNotFound,
});

function DeviceNotFound() {
  const { slug } = Route.useParams();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">No device "{slug}"</h1>
      <p>
        <Link to="/" className="text-brand hover:underline">
          See all phones
        </Link>
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** The photo, large, with the credit its licence asks for under it. */
function DevicePhoto({ device }: { device: Device }) {
  const src = devicePhoto(device);
  const [failed, setFailed] = useState(false);
  const ownPhoto = !!device.image_url && src === device.image_url;
  return (
    <figure className="flex flex-col gap-2">
      <div
        className={`flex items-center justify-center overflow-hidden rounded-2xl border bg-muted/40 ${src && !failed ? "p-3" : "aspect-[4/5] p-6"}`}
      >
        {src && !failed ? (
          <img
            src={src}
            alt={device.name}
            onError={() => setFailed(true)}
            style={{ viewTransitionName: vtName("img", device.slug) }}
            className="max-h-[28rem] max-w-full rounded-lg object-contain"
          />
        ) : (
          <PhoneOutline className="h-3/4 w-auto text-muted-foreground/60" style={{ viewTransitionName: vtName("img", device.slug) }} />
        )}
      </div>
      {ownPhoto && (device.image_credit || device.image_license) ? (
        <figcaption className="text-xs text-muted-foreground">
          Photo:{" "}
          {device.image_source_url ? (
            <a href={device.image_source_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
              {[device.image_credit, device.image_license].filter(Boolean).join(", ")}
            </a>
          ) : (
            [device.image_credit, device.image_license].filter(Boolean).join(", ")
          )}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Every repo that supports this phone, upstream first, and how. */
function SupportedBy({ device, forks }: { device: Device; forks: Map<string, Fork> }) {
  const rows = supportersOf(device);
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="supported-heading" className="flex flex-col gap-3">
      <h2 id="supported-heading" className="text-base font-semibold">
        Supported by
      </h2>
      <ul className="flex flex-col divide-y rounded-lg border">
        {rows.map((s) => {
          const fork = forks.get(s.repo.toLowerCase());
          const kind = s.kind === "upstream" ? "Main repo" : s.kind === "standalone" ? "Standalone port" : "Fork";
          return (
            <li key={s.repo} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <a
                  href={fork ? forkHref(fork) : `https://github.com/${s.repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium break-all hover:underline"
                >
                  {s.repo}
                </a>
                <p className="text-xs text-muted-foreground">
                  {kind}, {supportPhrase(s.support, s.via).toLowerCase()}
                  {s.note ? `: ${s.note}` : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs sm:justify-end">
                <span className="text-muted-foreground">Based on</span>
                <BasedOnChips
                  fork={fork ?? { repo: s.repo, kind: s.kind, base_project: s.base_project || (s.repo === ONEIOS_REPO ? "OneiOS" : "") }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DevicePage() {
  const { device, areas } = Route.useLoaderData();
  const { canEdit } = useAuth();
  const editable = canEdit(device.slug);
  const [uploads, setUploads] = useState(0);
  const rows = areas.map((area) => ({ area, entry: entryFor(device, area.slug), applies: applies(area, device) }));
  const counts = stateCounts(device, areas);
  const maintainers = maintainersOf(device);
  const forkMap = useMemo(() => new Map(device.forks.map((f) => [f.repo.toLowerCase(), f])), [device.forks]);
  const areaNames = useMemo(() => Object.fromEntries(areas.map((a) => [a.slug, a.name])), [areas]);
  const applicable = applicableAreas(device, areas);
  const families = familiesOfDevice(device, forkMap);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-5">
        <Link
          to="/"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          All phones
        </Link>
        <div className="grid gap-8 md:grid-cols-[minmax(0,20rem)_1fr] lg:grid-cols-[minmax(0,22rem)_1fr]">
          <DevicePhoto device={device} />
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-2xl font-semibold tracking-tight" style={{ viewTransitionName: vtName("name", device.slug) }}>{device.name}</h1>
                <StateLabel state={device.status} className="text-sm" />
                <FamilyChip families={families} />
              </div>
              {device.ios_version ? (
                <p className="w-fit text-3xl font-semibold tracking-tight" style={{ viewTransitionName: vtName("ios", device.slug) }}>{device.ios_version}</p>
              ) : (
                <p className="w-fit text-lg text-muted-foreground" style={{ viewTransitionName: vtName("ios", device.slug) }}>iOS version not stated</p>
              )}
              {device.best_result ? <p className="max-w-3xl text-base">{device.best_result}</p> : null}
            </div>

            <dl className="grid gap-x-8 gap-y-3 rounded-lg border px-4 py-3 sm:grid-cols-2">
              <Fact label="Model">{device.model || <span className="text-muted-foreground">Not recorded</span>}</Fact>
              <Fact label="SoC">{device.soc || <span className="text-muted-foreground">Not recorded</span>}</Fact>
              <Fact label="Maintainer">
                {maintainers.length > 0 ? maintainers.join(", ") : <span className="text-muted-foreground">Unclaimed</span>}
              </Fact>
              <Fact label="Updated">
                {device.updated ? (
                  <time dateTime={device.updated} title={formatDate(device.updated)} suppressHydrationWarning>
                    {relativeTime(device.updated)}
                  </time>
                ) : (
                  <span className="text-muted-foreground">Never</span>
                )}
              </Fact>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <dt className="text-xs text-muted-foreground">
                  {applicable.length} areas{applicable.length < areas.length ? `, ${areas.length - applicable.length} not applicable` : ""}
                </dt>
                <dd>
                  <StatusBar counts={counts} className="max-w-xl" />
                </dd>
              </div>
            </dl>
            {device.notes ? (
              <p className="max-w-3xl break-words text-muted-foreground">
                <LinkedText text={device.notes} />
              </p>
            ) : null}
            {editable ? (
              <div>
                <UploadButton
                  deviceSlug={device.slug}
                  deviceName={device.name}
                  areas={applicable}
                  forks={device.forks}
                  onUploaded={() => setUploads((n) => n + 1)}
                />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <SupportedBy device={device} forks={forkMap} />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Areas</h2>
        <AreaTable deviceSlug={device.slug} rows={rows} editable={editable} />
      </section>

      <MediaGallery deviceSlug={device.slug} areaNames={areaNames} reloadKey={uploads} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Repos</h2>
          {editable ? (
            <span className="ml-auto">
              <ForkDialog deviceSlug={device.slug} />
            </span>
          ) : null}
        </div>
        <ReposTable
          forks={device.forks}
          deviceNames={{ [device.slug]: device.name }}
          showDevice={false}
          canEdit={canEdit}
          areas={applicable}
          emptyText="No forks for this phone yet."
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Claims</h2>
        <ClaimPanel deviceSlug={device.slug} claims={device.claims} />
      </section>
    </div>
  );
}

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
import { AddRepoToPhone, PortPromptBox, ThisIsMine } from "@/components/RepoClaim";
import { ClaimThisPhone, isDependency, isUnclaimed } from "@/components/ClaimCallout";
import { DeviceUpdates } from "@/components/DeviceUpdates";
import { BasedOnChips, ReposTable, forkHref } from "@/components/ReposTable";
import { MediaGallery, UploadButton } from "@/components/Media";
import { devicePhoto } from "@/components/DeviceCard";
import { PhoneOutline } from "@/components/common";
import { ONEIOS_REPO, familiesOfDevice, supportPhrase, supportersOf } from "@/components/repoInfo";
import { FamilyChip } from "@/components/DeviceCard";
import { applicableAreas, applies, entryFor, stateCounts, isExtra } from "@/lib/areas";
import { OS_LABELS, forkMaintainer, loadDevice, maintainersOf, type Os, type Area, type Device, type Fork } from "@/lib/client";
import { LinkedText } from "@/components/SourceLink";
import { cn, formatDate, relativeTime, vtName } from "@/lib/utils";
import { SITE_URL, absoluteUrl, jsonLd, seo } from "@/lib/seo";

export const Route = createFileRoute("/device/$slug")({
  loader: async ({ params }) => {
    const res = await loadDevice({ data: params.slug });
    if (!res.device) throw notFound();
    return res as { device: Device; areas: Area[] };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const d = loaderData.device;
    const path = `/device/${encodeURIComponent(d.slug)}`;
    const photo = devicePhoto(d);
    const lead = [d.model, d.soc].filter(Boolean).join(", ");
    const description = [`iOS on the ${d.name}${lead ? ` (${lead})` : ""}.`, d.best_result || d.notes].filter(Boolean).join(" ");
    return {
      ...seo({ title: `${d.name}: iOS status on iOSOnAnd`, description, path, image: photo, type: "article" }),
      scripts: [
        jsonLd({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Devices", item: `${SITE_URL}/` },
            { "@type": "ListItem", position: 2, name: d.name, item: absoluteUrl(path) },
          ],
        }),
      ],
    };
  },
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
        className={`flex items-center justify-center overflow-hidden rounded-2xl border bg-muted/40 ${src && !failed ? "p-3" : "h-[200px] p-6 md:aspect-[4/5] md:h-auto"}`}
      >
        {src && !failed ? (
          <img
            src={src}
            alt={device.name}
            onError={() => setFailed(true)}
            style={{ viewTransitionName: vtName("img", device.slug) }}
            className="max-h-[200px] max-w-full rounded-lg object-contain md:max-h-[28rem]"
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
                  className="inline-flex min-h-8 items-center font-medium break-all hover:underline"
                >
                  {s.repo}
                </a>
                <p className="text-xs text-muted-foreground">
                  {kind}, {supportPhrase(s.support, s.via).toLowerCase()}, {fork && !isUnclaimed(fork) ? `maintained by ${forkMaintainer(fork)}` : "unclaimed"}
                  {s.note ? `: ${s.note}` : null}
                </p>
              </div>
              {fork && isUnclaimed(fork) && !isDependency(fork) ? (
                <ThisIsMine repo={s.repo} device={device.slug} devices={[{ slug: device.slug, name: device.name }]} compact label="Claim" />
              ) : null}
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
  // The area table shows one system at a time: iOS (and iPadOS), or macOS / tvOS when the phone has rows or a version for them.
  const [os, setOs] = useState<Os>("ios");
  const systems = (["ios", "macos", "tvos"] as const).filter(
    (o) => o === "ios" || editable || (device.os_statuses?.[o]?.length ?? 0) > 0 || !!device[`${o}_version` as "macos_version" | "tvos_version"],
  );
  const osStatuses = os === "ios" ? device.statuses : (device.os_statuses?.[os] ?? []);
  const rows = areas.map((area) => ({ area, entry: entryFor({ statuses: osStatuses }, area.slug), applies: applies(area, device) }));
  const counts = stateCounts(device, areas);
  const maintainers = maintainersOf(device);
  const forkMap = useMemo(() => new Map(device.forks.map((f) => [f.repo.toLowerCase(), f])), [device.forks]);
  const areaNames = useMemo(() => Object.fromEntries(areas.map((a) => [a.slug, a.name])), [areas]);
  const applicable = applicableAreas(device, areas);
  const iosAreas = areas.filter((a) => !isExtra(a)).length;
  const families = familiesOfDevice(device, forkMap);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-5">
        <Link
          to="/"
          className="-my-2.5 inline-flex min-h-11 w-fit items-center gap-1 pr-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          All phones
        </Link>
        <div className="grid gap-5 md:gap-8 md:grid-cols-[minmax(0,20rem)_1fr] lg:grid-cols-[minmax(0,22rem)_1fr]">
          <DevicePhoto device={device} />
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-2xl font-semibold tracking-tight" style={{ viewTransitionName: vtName("name", device.slug) }}>{device.name}</h1>
                <span className="inline-flex" style={{ viewTransitionName: vtName("state", device.slug) }}><StateLabel state={device.status} className="text-sm" /></span>
                <span className="inline-flex" style={{ viewTransitionName: vtName("family", device.slug) }}><FamilyChip families={families} /></span>
              </div>
              {device.ios_version ? (
                <p className="w-fit text-2xl font-semibold tracking-tight sm:text-3xl" style={{ viewTransitionName: vtName("ios", device.slug) }}>{device.ios_version}</p>
              ) : (
                <p className="w-fit text-lg text-muted-foreground" style={{ viewTransitionName: vtName("ios", device.slug) }}>iOS version not stated</p>
              )}
              {device.macos_version || device.tvos_version ? (
                <p className="w-fit text-lg font-semibold tracking-tight text-muted-foreground">
                  {[device.macos_version, device.tvos_version].filter(Boolean).join(", ")}
                </p>
              ) : null}
              {device.model || device.soc ? (
                <p className="w-fit text-sm text-muted-foreground" style={{ viewTransitionName: vtName("sub", device.slug) }}>
                  {[device.model, device.soc].filter(Boolean).join(" · ")}
                </p>
              ) : null}
              {device.best_result ? <p className="max-w-3xl text-base">{device.best_result}</p> : null}
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border px-4 py-3 sm:gap-x-8">
              <Fact label="Model">{device.model || <span className="text-muted-foreground">Not recorded</span>}</Fact>
              <Fact label="SoC">{device.soc || <span className="text-muted-foreground">Not recorded</span>}</Fact>
              <Fact label="Maintainer">
                <span className="inline-block" style={{ viewTransitionName: vtName("repo", device.slug) }}>
                  {maintainers.length > 0 ? maintainers.join(", ") : <span className="text-muted-foreground">Unclaimed</span>}
                </span>
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
              <div className="col-span-2 flex flex-col gap-1.5">
                <dt className="text-xs text-muted-foreground">
                  {applicable.length} iOS areas
                  {applicable.length < iosAreas ? `, ${iosAreas - applicable.length} not applicable` : ""}
                </dt>
                <dd>
                  <div className="w-full md:max-w-xl" style={{ viewTransitionName: vtName("bar", device.slug) }}><StatusBar counts={counts} /></div>
                </dd>
              </div>
            </dl>
            {device.notes ? (
              <p className="max-w-3xl break-words text-muted-foreground">
                <LinkedText text={device.notes} />
              </p>
            ) : null}
            {editable || maintainers.length === 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {maintainers.length === 0 ? <AddRepoToPhone device={{ slug: device.slug, name: device.name }} /> : null}
                {editable ? <UploadButton
                  deviceSlug={device.slug}
                  deviceName={device.name}
                  areas={applicable}
                  forks={device.forks}
                  onUploaded={() => setUploads((n) => n + 1)}
                /> : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <ClaimThisPhone device={device} />

      <SupportedBy device={device} forks={forkMap} />

      <section aria-labelledby="areas-heading" className="flex scroll-mt-20 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="areas-heading" className="text-base font-semibold">
            Areas
          </h2>
          {systems.length > 1 ? (
            <div role="group" aria-label="System" className="inline-flex rounded-md border p-0.5">
              {systems.map((o) => {
                const version = o === "ios" ? "" : device[`${o}_version` as "macos_version" | "tvos_version"];
                return (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={os === o}
                    onClick={() => setOs(o)}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10 pointer-coarse:px-3",
                      os === o ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {OS_LABELS[o]}
                    {version ? <span className="text-xs text-muted-foreground">{version.replace(/^(macOS|tvOS)\s*/i, "")}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <AreaTable deviceSlug={device.slug} rows={rows} editable={editable} os={os} />
      </section>

      <DeviceUpdates deviceSlug={device.slug} editable={editable} onPosted={() => setUploads((n) => n + 1)} />

      <MediaGallery deviceSlug={device.slug} areaNames={areaNames} reloadKey={uploads} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Repos</h2>
          <span className="ml-auto flex items-center gap-2">
            {/* Your own GitHub repo for this phone: claim it (src/lib/repos.ts). */}
            <AddRepoToPhone device={{ slug: device.slug, name: device.name }} />
            {editable ? <ForkDialog deviceSlug={device.slug} /> : null}
          </span>
        </div>
        <ReposTable
          forks={device.forks}
          deviceNames={{ [device.slug]: device.name }}
          showDevice={false}
          canEdit={canEdit}
          areas={applicable}
          emptyText="No forks for this phone yet."
        />
        <PortPromptBox device={device.slug} deviceName={device.name} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Claims</h2>
        <ClaimPanel deviceSlug={device.slug} claims={device.claims} />
      </section>
    </div>
  );
}

import { Link, useNavigate } from "@tanstack/react-router";
import { StatusBar } from "@/components/StatusBadge";
import { mainRepoOf } from "@/components/repoInfo";
import { FamilyChip } from "@/components/DeviceCard";
import { stateCounts, type StateCounts } from "@/lib/areas";
import { maintainersOf, type Area, type Device } from "@/lib/client";

export interface DeviceSummary {
  device: Device;
  counts: StateCounts;
  /** The repo shown for the device (repoInfo.mainRepoOf). */
  mainRepo?: string | null;
  /** What the port is based on (repoInfo.familiesOfDevice). */
  families?: string[];
}

export function summarize(devices: Device[], areas: Area[]): DeviceSummary[] {
  return devices.map((device) => ({ device, counts: stateCounts(device, areas) }));
}

const TH = "h-9 px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground";

/** One row per phone; the row opens the device page. */
export function DevicesTable({ rows }: { rows: DeviceSummary[] }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th scope="col" className={TH}>
              Device
            </th>
            <th scope="col" className={`${TH} hidden md:table-cell`}>
              Based on
            </th>
            <th scope="col" className={`${TH} hidden lg:table-cell`}>
              Best result
            </th>
            <th scope="col" className={`${TH} w-72`}>
              Areas
            </th>
            <th scope="col" className={`${TH} hidden sm:table-cell`}>
              Repo
            </th>
            <th scope="col" className={`${TH} hidden md:table-cell`}>
              Maintainer
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(({ device: d, counts, mainRepo: shownRepo, families }) => {
            const mainRepo = shownRepo === undefined ? mainRepoOf(d) : shownRepo;
            const sub = [d.model, d.soc].filter(Boolean).join(", ");
            const maintainers = maintainersOf(d);
            return (
              <tr
                key={d.slug}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a, button")) return;
                  void navigate({ to: "/device/$slug", params: { slug: d.slug } });
                }}
                className="cursor-pointer transition-colors hover:bg-muted/50"
              >
                <td className="px-3 py-2.5 align-middle">
                  <Link
                    to="/device/$slug"
                    params={{ slug: d.slug }}
                    className="font-medium whitespace-nowrap outline-none hover:underline focus-visible:underline"
                  >
                    {d.name}
                  </Link>
                  <div className="text-xs whitespace-nowrap text-muted-foreground">{sub || "Model not recorded"}</div>
                </td>
                <td className="hidden px-3 py-2.5 align-middle md:table-cell">
                  {families ? <FamilyChip families={families} /> : null}
                </td>
                <td className="hidden max-w-0 px-3 py-2.5 align-middle lg:table-cell lg:w-[34%]">
                  {d.best_result ? (
                    <p className="truncate" title={d.best_result}>
                      {d.best_result}
                    </p>
                  ) : (
                    <span className="text-muted-foreground">None reported</span>
                  )}
                </td>
                <td className="px-3 py-2.5 align-middle">
                  <StatusBar counts={counts} />
                </td>
                <td className="hidden px-3 py-2.5 align-middle whitespace-nowrap sm:table-cell">
                  {mainRepo ? (
                    <div className="flex flex-col">
                      <a
                        href={`https://github.com/${mainRepo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="max-w-56 truncate font-mono text-xs hover:underline"
                      >
                        {mainRepo}
                      </a>
                      {d.forks.length > 1 ? (
                        <Link
                          to="/"
                          search={{ tab: "repos", device: d.slug }}
                          className="text-xs text-muted-foreground tabular-nums hover:underline"
                        >
                          {d.forks.length} repos
                        </Link>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </td>
                <td className="hidden px-3 py-2.5 align-middle whitespace-nowrap md:table-cell">
                  {maintainers.length > 0 ? (
                    maintainers.join(", ")
                  ) : (
                    <span className="text-muted-foreground">Unclaimed</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

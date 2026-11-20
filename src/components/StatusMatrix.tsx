import { Link } from "@tanstack/react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Area, Device } from "@/lib/client";
import { StateBadge } from "@/components/StatusBadge";

export function StatusMatrix({ areas, devices }: { areas: Area[]; devices: Device[] }) {
  if (areas.length === 0 || devices.length === 0) return <p>No data yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Area</TableHead>
            {devices.map((d) => (
              <TableHead key={d.slug}>
                <Link to="/device/$slug" params={{ slug: d.slug }} className="underline">
                  {d.name}
                </Link>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {areas.map((a) => (
            <TableRow key={a.slug}>
              <TableCell className="font-medium">{a.name}</TableCell>
              {devices.map((d) => {
                const entry = d.statuses.find((s) => s.area_slug === a.slug);
                return (
                  <TableCell key={d.slug} title={entry?.detail || a.name}>
                    <StateBadge state={entry?.state ?? "unknown"} />
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

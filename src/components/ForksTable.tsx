import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Fork } from "@/lib/client";
import { VerifiedBadge } from "@/components/StatusBadge";

export function ForksTable({ forks }: { forks: Fork[] }) {
  if (forks.length === 0) return <p>No forks yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Repo</TableHead>
            <TableHead>Device</TableHead>
            <TableHead>Best result</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {forks.map((f) => (
            <TableRow key={f.id}>
              <TableCell>
                <a
                  href={f.url || `https://github.com/${f.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline"
                >
                  {f.repo}
                </a>
              </TableCell>
              <TableCell>{f.device_slug ?? "—"}</TableCell>
              <TableCell>{f.best_result || "—"}</TableCell>
              <TableCell>
                <VerifiedBadge verified={f.verified} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

import { Badge } from "@/components/ui/badge";
import type { AreaState, ClaimStatus, Verified } from "@/lib/client";
import { cn } from "@/lib/utils";

const STATE_STYLES: Record<AreaState, string> = {
  works: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  "in-progress": "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  broken: "bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100",
  unknown: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

export function StateBadge({ state }: { state: AreaState }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STATE_STYLES[state])}>
      {state}
    </Badge>
  );
}

const VERIFIED_STYLES: Record<Verified, string> = {
  merged: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  reproduced: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  "fork-claim": "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

export function VerifiedBadge({ verified }: { verified: Verified }) {
  return (
    <Badge variant="outline" className={cn("font-medium", VERIFIED_STYLES[verified])}>
      {verified}
    </Badge>
  );
}

const CLAIM_STYLES: Record<ClaimStatus, string> = {
  approved: "bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100",
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  rejected: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

export function ClaimBadge({ status }: { status: ClaimStatus }) {
  return (
    <Badge variant="outline" className={cn("font-medium", CLAIM_STYLES[status])}>
      {status}
    </Badge>
  );
}

import { useNavigate } from "@tanstack/react-router";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { Device } from "@/lib/client";
import { StateBadge } from "@/components/StatusBadge";

export function SearchHeader({
  query,
  onQuery,
  results,
}: {
  query: string;
  onQuery: (q: string) => void;
  results: Device[];
}) {
  const navigate = useNavigate();
  return (
    <Command className="rounded-lg border" shouldFilter={false}>
      <CommandInput
        value={query}
        onValueChange={onQuery}
        placeholder="Search name, model, SoC, repo"
        aria-label="Search devices"
      />
      <CommandList>
        {query.length > 0 && results.length === 0 ? (
          <CommandEmpty>No devices match.</CommandEmpty>
        ) : null}
        {results.map((d) => (
          <CommandItem
            key={d.slug}
            value={d.slug}
            onSelect={() => navigate({ to: "/device/$slug", params: { slug: d.slug } })}
            className="flex items-center gap-4"
          >
            <span className="font-medium">{d.name}</span>
            <span className="text-sm text-muted-foreground">
              {d.model} {d.soc}
            </span>
            <span className="ml-auto">
              <StateBadge state={d.status} />
            </span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}

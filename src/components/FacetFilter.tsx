/**
 * A faceted filter (shadcn's data-table pattern): an outline button that opens
 * a searchable list with counts. Several values can be picked (or one, with
 * `single`); the picks show as badges in the button.
 */
import { Check, PlusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export function FacetFilter({
  title,
  options,
  selected,
  onChange,
  single = false,
  className,
}: {
  title: string;
  options: FacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  single?: boolean;
  className?: string;
}) {
  const picked = new Set(selected);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  function toggle(v: string) {
    if (single) return onChange(picked.has(v) ? [] : [v]);
    const next = new Set(picked);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...next]);
  }
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" className={cn("rounded-full", !picked.size && "border-dashed", className)} />
        }
      >
        <PlusCircle className={cn("text-muted-foreground", picked.size && "hidden")} aria-hidden />
        {title}
        {picked.size ? (
          <>
            <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
            {picked.size > 2 ? (
              <Badge variant="secondary" className="rounded-sm">
                {picked.size} selected
              </Badge>
            ) : (
              selected.map((v) => (
                <Badge key={v} variant="secondary" className="max-w-32 rounded-sm">
                  <span className="truncate">{labelOf(v)}</span>
                </Badge>
              ))
            )}
          </>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = picked.has(o.value);
                return (
                  <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => toggle(o.value)} data-checked={on} className="[&>svg:last-child]:hidden">
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center border",
                        single ? "rounded-full" : "rounded-[4px]",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                      aria-hidden
                    >
                      {on ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{o.count}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {picked.size ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value="__clear" onSelect={() => onChange([])} className="justify-center text-center [&>svg:last-child]:hidden">
                    Clear {title.toLowerCase()}
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { CopyButton } from "@/components/common";
import { cn } from "@/lib/utils";

/** A card section of the profile page: a title, optional actions on the right, the body. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = `panel-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={cn("flex min-w-0 flex-col gap-4 rounded-[14px] border bg-card p-4 text-card-foreground sm:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold">
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** One shell command (or any line to copy) with a copy button. */
export function CodeLine({ text, label = "Copy" }: { text: string; label?: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md border bg-muted/40 py-1 pr-1 pl-3">
      <code suppressHydrationWarning className="min-w-0 flex-1 py-1.5 font-mono text-xs break-all">
        {text}
      </code>
      <CopyButton text={text} label={label} toastText="Copied" variant="ghost" />
    </div>
  );
}

/** Numbered steps; steps before `current` show as done. */
export function Steps({ current, steps }: { current: number; steps: Array<{ title: string; body?: ReactNode }> }) {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                done && "border-foreground bg-foreground text-background",
                active && "border-foreground",
                !done && !active && "text-muted-foreground",
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <div className={cn("flex min-w-0 flex-1 flex-col gap-2 pt-0.5", !done && !active && "opacity-60")}>
              <p className="font-medium">
                <span className="sr-only">{done ? "Done: " : active ? "Now: " : ""}</span>
                {s.title}
              </p>
              {active && s.body ? s.body : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The site origin as the browser sees it (empty during server render). */
export function siteOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

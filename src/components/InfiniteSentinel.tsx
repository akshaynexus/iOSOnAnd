import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Infinite scroll for a page-level list: calls `onMore` when this marker comes
 * within `margin` px of the viewport. It observes again after every batch
 * (`count`), so a tall screen keeps loading until the marker is out of view.
 * Without IntersectionObserver it falls back to a button.
 */
export function InfiniteSentinel({
  onMore,
  count,
  total,
  margin = 600,
}: {
  onMore: () => void;
  count: number;
  total: number;
  margin?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [supported, setSupported] = useState(true);
  const moreRef = useRef(onMore);
  moreRef.current = onMore;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSupported(false);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) moreRef.current();
    }, { rootMargin: `0px 0px ${margin}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [count, margin]);

  return (
    <div ref={ref} className="flex flex-col items-center gap-1 py-2">
      {supported ? null : (
        <Button variant="outline" onClick={onMore}>
          Show more
        </Button>
      )}
      <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {count} of {total}
      </p>
    </div>
  );
}

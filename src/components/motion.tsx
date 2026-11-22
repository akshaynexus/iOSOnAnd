/**
 * Small, owner-requested motion: reveal on first view, count-up numbers,
 * crossfades for filter changes, a highlight after a write, and loading
 * skeletons. CSS transitions and the Web Animations API only; transform and
 * opacity only; everything is off under prefers-reduced-motion (the CSS in
 * styles.css and the checks here).
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ElementType, ReactNode, RefObject } from "react";
import { flushSync } from "react-dom";
import { cn } from "@/lib/utils";

export function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

type Seen = (order: number) => void;
const waiting = new Map<Element, Seen>();
let shared: IntersectionObserver | null = null;

/** One observer for every reveal on the page; entries seen together are staggered. */
function observer(): IntersectionObserver {
  if (shared) return shared;
  shared = new IntersectionObserver(
    (entries) => {
      let order = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const cb = waiting.get(e.target);
        if (!cb) continue;
        waiting.delete(e.target);
        shared?.unobserve(e.target);
        cb(Math.min(order++, 8));
      }
    },
    { rootMargin: "0px 0px -4% 0px" },
  );
  return shared;
}

/**
 * Null until the element first scrolls into view, then its order in that
 * batch (0..8, for a stagger). Immediately 0 without IntersectionObserver or
 * with reduced motion.
 */
export function useSeenOnce(ref: RefObject<Element | null>): number | null {
  const [order, setOrder] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined" || reducedMotion()) {
      setOrder(0);
      return;
    }
    waiting.set(el, (n) => setOrder(n));
    observer().observe(el);
    return () => {
      waiting.delete(el);
      shared?.unobserve(el);
    };
  }, [ref]);
  return order;
}

/** Fades and rises its child in (~280 ms, 30 ms stagger) the first time it enters the viewport. */
export function Reveal({
  as: Tag = "div",
  className,
  children,
  style,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);
  const order = useSeenOnce(ref);
  return (
    <Tag
      ref={ref}
      className={cn("reveal", className)}
      data-seen={order === null ? undefined : ""}
      style={{ ...style, "--reveal-delay": `${(order ?? 0) * 30}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

/** A number that counts up from 0 (≤ 600 ms, ease-out) the first time it is seen. */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const order = useSeenOnce(ref);
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (order === null || reducedMotion() || value <= 0) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const duration = Math.min(600, 250 + value * 4);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // rAF pauses in a hidden tab: land on the true value regardless.
    const done = window.setTimeout(() => {
      cancelAnimationFrame(raf);
      setShown(value);
    }, duration + 50);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, [order, value]);
  return (
    <span ref={ref} className={className} aria-label={String(value)}>
      <span aria-hidden>{shown}</span>
    </span>
  );
}

/**
 * Run a state change inside a View Transition (a short crossfade of what
 * changed) where the browser has one and motion is allowed; else run it plainly.
 */
export function withViewTransition(fn: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || reducedMotion()) {
    fn();
    return;
  }
  doc.startViewTransition(() => flushSync(fn));
}

/**
 * Flash a background highlight on an element (~800 ms) after a write changed
 * it. Web Animations API; nothing under reduced motion.
 */
export function flash(el: Element | null | undefined) {
  if (!el || reducedMotion() || !(el as HTMLElement).animate) return;
  (el as HTMLElement).animate(
    [{ backgroundColor: "color-mix(in oklch, var(--brand) 18%, transparent)" }, { backgroundColor: "transparent" }],
    { duration: 800, easing: "ease-out" },
  );
}

/** Grey blocks with a shimmer, shown only while something loads. */
export function Skeleton({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("skeleton rounded-lg", className)}>
      <span className="sr-only">{label}</span>
    </div>
  );
}

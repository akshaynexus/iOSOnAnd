/**
 * A page-wide budget for WebGL contexts.
 *
 * Browsers keep about 16 live WebGL contexts per page and drop the oldest
 * when a new one is made (with a console warning). The device grid alone has
 * over 100 cards, so every WebGL effect here asks for a slot first:
 *
 * - a slot is requested only while the element is in or near the viewport
 *   (IntersectionObserver, 200px margin) and released when it leaves;
 * - each pool has a cap (cards 10, buttons 4; 14 in all, under the ~16 browsers allow); requests past the cap wait in
 *   order and get the next free slot;
 * - no slot at all when WebGL2 is missing, the user prefers reduced motion, or
 *   the device is touch-only ((hover: none) and (pointer: coarse)): there the
 *   tilt and specular light never follow a pointer, and up to 14 live contexts
 *   cost scroll smoothness on a phone GPU for no visible effect.
 *
 * A component without a slot renders its CSS-only look.
 */
import { useEffect, useState } from "react";
import type { RefObject } from "react";

export type GlPool = "card" | "button";

const CAPS: Record<GlPool, number> = { card: 10, button: 4 };

interface Ticket {
  granted: boolean;
  grant: () => void;
}

const pools: Record<GlPool, { live: number; waiting: Ticket[] }> = {
  card: { live: 0, waiting: [] },
  button: { live: 0, waiting: [] },
};

let supported: boolean | null = null;

/** WebGL2 works here. Probes once; the probe context is released at once. */
export function webgl2Supported(): boolean {
  if (supported !== null) return supported;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    supported = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    supported = false;
  }
  return supported;
}

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** A phone or tablet with no mouse: the effects have no pointer to follow. */
export function touchOnly(): boolean {
  try {
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  } catch {
    return false;
  }
}

function request(pool: GlPool, ticket: Ticket) {
  const p = pools[pool];
  if (ticket.granted || p.waiting.includes(ticket)) return;
  if (p.live < CAPS[pool]) {
    p.live++;
    ticket.granted = true;
    ticket.grant();
  } else {
    p.waiting.push(ticket);
  }
}

function release(pool: GlPool, ticket: Ticket) {
  const p = pools[pool];
  const i = p.waiting.indexOf(ticket);
  if (i >= 0) p.waiting.splice(i, 1);
  if (!ticket.granted) return;
  ticket.granted = false;
  p.live--;
  const next = p.waiting.shift();
  if (next) request(pool, next);
}

/** Live counts, for the debug line in tests and for screenshots. */
export function glBudgetState(): Record<GlPool, number> {
  return { card: pools.card.live, button: pools.button.live };
}

/**
 * True while this element holds a WebGL slot. `enabled: false` never asks.
 * When the slot goes, the caller must drop its context (unmount the canvas).
 */
export function useGlSlot(ref: RefObject<Element | null>, pool: GlPool, enabled = true): boolean {
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver === "undefined") return;
    if (touchOnly() || prefersReducedMotion() || !webgl2Supported()) return;
    let alive = true;
    const ticket: Ticket = {
      granted: false,
      grant: () => {
        if (alive) setGranted(true);
      },
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const near = entries.some((e) => e.isIntersecting);
        if (near) request(pool, ticket);
        else {
          release(pool, ticket);
          if (alive) setGranted(false);
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(element);
    return () => {
      alive = false;
      observer.disconnect();
      release(pool, ticket);
      setGranted(false);
    };
  }, [ref, pool, enabled]);

  return granted;
}

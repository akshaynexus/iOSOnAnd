import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { errorParts } from "@/lib/client";

/** Show an API error as a toast: the error as the title, its hint below. */
export function toastError(err: unknown) {
  const { message, hint } = errorParts(err);
  toast.error(message, hint ? { description: hint } : undefined);
}

/**
 * Wrap an async action so it runs once at a time (a second click or Enter
 * while it runs is ignored), reports errors as toasts, and exposes `pending`.
 * Resolves true when the action succeeded.
 */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async (...args: A): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setPending(true);
    try {
      await fnRef.current(...args);
      return true;
    } catch (err) {
      toastError(err);
      return false;
    } finally {
      running.current = false;
      setPending(false);
    }
  }, []);
  return [run, pending] as const;
}

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useTheme } from "next-themes";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import SpecularButton from "@/components/reactbits/SpecularButton";
import { cn } from "@/lib/utils";

/** "dark" or "light" once mounted; "light" during SSR and the first render. */
export function useThemeMode(): "dark" | "light" {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && resolvedTheme === "dark" ? "dark" : "light";
}

export async function copyText(text: string, what = "Copied"): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
    return true;
  } catch {
    toast.error("Copy failed", { description: "Select the text and copy it by hand." });
    return false;
  }
}

/** A small copy button that shows a check for a moment after copying. */
export function CopyButton({
  text,
  label = "Copy",
  toastText,
  className,
  size = "sm",
  variant = "outline",
}: {
  text: string;
  label?: string;
  toastText?: string;
  className?: string;
  size?: "sm" | "xs" | "icon-sm";
  variant?: "outline" | "ghost" | "secondary";
}) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      aria-label={size === "icon-sm" ? label : undefined}
      onClick={async () => setDone(await copyText(text, toastText ?? "Copied"))}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      {size === "icon-sm" ? null : done ? "Copied" : label}
    </Button>
  );
}

/**
 * The primary call to action: React Bits' SpecularButton with colours for the
 * current theme. Dark: the original's glass tint and white rim. Light: a dark
 * filled button (it reads on white) with the same white specular rim.
 */
export function PrimaryAction({
  children,
  onClick,
  type = "button",
  disabled,
  size = "sm",
  className,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
  form?: string;
}) {
  const mode = useThemeMode();
  const dark = mode === "dark";
  return (
    <SpecularButton
      size={size}
      type={type}
      disabled={disabled}
      onClick={onClick}
      radius={10}
      tint={dark ? "#ffffff" : "#18181b"}
      tintOpacity={dark ? 0.07 : 1}
      textColor={dark ? "#f5f5f5" : "#fafafa"}
      lineColor="#ffffff"
      baseColor={dark ? "#525252" : "#3f3f46"}
      idleIntensity={0.35}
      proximity={180}
      className={cn("primary-action", className)}
      {...rest}
    >
      {children}
    </SpecularButton>
  );
}

/** A neutral phone outline for devices without a photo. */
export function PhoneOutline({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 120 220" fill="none" aria-hidden className={className} style={style}>
      <rect x="10" y="6" width="100" height="208" rx="18" stroke="currentColor" strokeWidth="3" />
      <rect x="18" y="20" width="84" height="176" rx="8" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <circle cx="60" cy="13" r="2.5" fill="currentColor" opacity="0.6" />
      <rect x="111" y="52" width="3" height="22" rx="1.5" fill="currentColor" opacity="0.6" />
      <rect x="111" y="82" width="3" height="34" rx="1.5" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

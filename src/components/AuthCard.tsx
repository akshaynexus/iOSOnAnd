import type { ReactNode } from "react";

/** The frame for the account pages: log in, sign up and password reset. */
export function AuthCard({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4 pt-2 sm:pt-10">
      <div className="flex flex-col gap-6 rounded-[14px] border bg-card p-6 text-card-foreground shadow-xs sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {children}
      </div>
      {footer ? <p className="text-center text-sm text-muted-foreground">{footer}</p> : null}
    </div>
  );
}

/** A quiet inline text link for the auth pages. */
export const authLink = "font-medium text-foreground underline-offset-4 hover:underline";

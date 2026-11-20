import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { AuthProvider, useAuth } from "@/components/auth";
import { logout } from "@/lib/client";

function SiteNav() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    try {
      await logout();
      navigate({ to: "/" });
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Logout failed");
    }
  }

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4">
        <Link to="/" className="text-lg font-semibold">
          iOSOnAnd
        </Link>
        <nav className="ml-auto flex items-center gap-2">
          {loading ? null : user ? (
            <>
              <Avatar>
                <AvatarFallback>
                  {(user.github_login ?? user.display_name ?? user.email ?? "?")
                    .slice(0, 2)
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <Link to="/profile" className="text-sm font-medium">
                {user.github_login ? `@${user.github_login}` : (user.display_name ?? user.email)}
              </Link>
              <Button variant="outline" size="sm" onClick={onLogout}>
                Log out
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" render={<Link to="/login">Log in</Link>} />
              <Button size="sm" render={<Link to="/signup">Sign up</Link>} />
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SiteNav />
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <Toaster />
    </AuthProvider>
  );
}

// The admin panel moved into the account page: /profile?tab=admin (admins
// only). This route stays so old links and bookmarks still land there.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin")({
  beforeLoad: () => {
    throw redirect({ to: "/profile", search: { tab: "admin" }, statusCode: 301 });
  },
});

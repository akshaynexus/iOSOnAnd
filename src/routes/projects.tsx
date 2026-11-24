// /projects moved into the Repos tab: the projects and their repos are one
// page now. ?project=<id> (e.g. hackios) opens that project there.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { PROJECTS } from "@/lib/projects";

export const Route = createFileRoute("/projects")({
  validateSearch: (search: Record<string, unknown>): { project?: string } =>
    typeof search.project === "string" ? { project: search.project } : {},
  beforeLoad: ({ search }) => {
    const family = PROJECTS.find((p) => p.id === search.project)?.family;
    throw redirect({ to: "/", search: { tab: "repos", ...(family ? { family } : {}) }, statusCode: 301 });
  },
});

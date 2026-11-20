import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ChangelogEntry, Post } from "@/lib/client";

export function UpdatesFeed({
  posts,
  changelog,
}: {
  posts: Post[];
  changelog: ChangelogEntry[];
}) {
  return (
    <Tabs defaultValue="posts">
      <TabsList aria-label="Updates">
        <TabsTrigger value="posts">Posts</TabsTrigger>
        <TabsTrigger value="changelog">Changelog</TabsTrigger>
      </TabsList>
      <TabsContent value="posts">
        {posts.length === 0 ? (
          <p>No posts yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {posts.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 rounded-md border p-4">
                <a href={p.url} target="_blank" rel="noreferrer" className="font-medium underline">
                  {p.title}
                </a>
                {p.published ? (
                  <span className="text-sm text-muted-foreground">{p.published}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
      <TabsContent value="changelog">
        {changelog.length === 0 ? (
          <p>No changes yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {changelog.map((c) => (
              <li key={c.id} className="flex gap-2 text-sm">
                <span className="text-muted-foreground">{c.created}</span>
                <span>
                  {c.who ? `${c.who}: ` : ""}
                  {c.summary}
                </span>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>
    </Tabs>
  );
}

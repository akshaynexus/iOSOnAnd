import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Page } from "@/components/Page";
import { useAuth } from "@/components/auth";
import { SearchHeader } from "@/components/SearchHeader";
import { DeviceCard } from "@/components/DeviceCard";
import { StatusMatrix } from "@/components/StatusMatrix";
import { ForksTable } from "@/components/ForksTable";
import { UpdatesFeed } from "@/components/UpdatesFeed";
import {
  errorMessage,
  getAreas,
  getChangelog,
  listDevices,
  listForks,
  listPosts,
  searchDevices,
  type Area,
  type ChangelogEntry,
  type Device,
  type Fork,
  type Post,
} from "@/lib/client";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [forks, setForks] = useState<Fork[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);

  const reload = useCallback(async () => {
    try {
      const [a, d, f, p, c] = await Promise.all([
        getAreas(),
        listDevices(),
        listForks(),
        listPosts(),
        getChangelog(),
      ]);
      setAreas(a.areas);
      setDevices(d.devices);
      setForks(f.forks);
      setPosts(p.posts);
      setChangelog(c.changelog);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (query.trim() === "") {
      void listDevices()
        .then((d) => setDevices(d.devices))
        .catch((err: unknown) => toast.error(errorMessage(err)));
      return;
    }
    const t = setTimeout(() => {
      void searchDevices(query)
        .then((d) => setDevices(d.devices))
        .catch((err: unknown) => toast.error(errorMessage(err)));
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const canEdit = user?.is_admin === true;
  const counts = devices.map((d) => d.status).reduce<Record<string, number>>((m, s) => {
    m[s] = (m[s] ?? 0) + 1;
    return m;
  }, {});

  return (
    <Page>
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold">iOS on Android</h1>
          <p className="text-muted-foreground">
            {devices.length} devices, {forks.length} forks, {posts.length} posts tracked.
            {counts.works ? ` ${counts.works} fully working.` : ""}
          </p>
          <SearchHeader query={query} onQuery={setQuery} results={query ? devices : []} />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Devices</h2>
          {devices.length === 0 ? (
            <p>No devices yet.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {devices.map((d) => (
                <DeviceCard key={d.slug} device={d} canEdit={canEdit} onChanged={reload} />
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Status matrix</h2>
          <StatusMatrix areas={areas} devices={devices} />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Forks</h2>
          <ForksTable forks={forks} />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Updates</h2>
          <UpdatesFeed posts={posts} changelog={changelog} />
        </section>
      </div>
    </Page>
  );
}

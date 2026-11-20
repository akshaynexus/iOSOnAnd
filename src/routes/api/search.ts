// /api/search — GET one-box search over devices, forks, areas, posts.
import { createFileRoute } from '@tanstack/react-router';
import { queryAll } from '@/lib/db';
import { handleError, json } from '@/lib/auth';

async function handleGet(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get('q') || '';
  const like = `%${q}%`;
  const [devices, forks, areas, posts] = await Promise.all([
    queryAll(
      'SELECT * FROM devices WHERE slug LIKE ? OR name LIKE ? OR model LIKE ? OR soc LIKE ? OR best_result LIKE ? ORDER BY slug',
      [like, like, like, like, like],
    ),
    queryAll(
      'SELECT * FROM forks WHERE repo LIKE ? OR branch LIKE ? OR best_result LIKE ? OR fork_only LIKE ? ORDER BY id',
      [like, like, like, like],
    ),
    queryAll('SELECT * FROM areas WHERE slug LIKE ? OR name LIKE ? ORDER BY slug', [like, like]),
    queryAll('SELECT * FROM reddit_posts WHERE title LIKE ? OR url LIKE ? ORDER BY id DESC', [like, like]),
  ]);
  return json({ q, devices, forks, areas, posts });
}

export const Route = createFileRoute('/api/search')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          return await handleGet(request);
        } catch (e) {
          return handleError(e);
        }
      },
    },
  },
});

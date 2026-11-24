// /docs and /docs/<page> — the documentation site (Fumadocs UI), from
// content/docs/*.mdx. The page tree comes from a server function; the page
// body is a compiled MDX chunk (src/lib/source.ts).

import { Suspense, use } from 'react';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { RootProvider } from 'fumadocs-ui/provider/tanstack';
import { useFumadocsLoader } from 'fumadocs-core/source/client';
import { docs, source } from '@/lib/source';
import { useMDXComponents } from '@/components/mdx';
import { seo } from '@/lib/seo';

const serverLoader = createServerFn({ method: 'GET' })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();
    return {
      path: page.path,
      title: page.data.title,
      description: page.data.description ?? '',
      pageTree: await source.serializePageTree(source.getPageTree()),
    };
  });

export const Route = createFileRoute('/docs/$')({
  component: DocsRoute,
  loader: async ({ params }) => {
    const slugs = params._splat?.split('/').filter(Boolean) ?? [];
    const data = await serverLoader({ data: slugs });
    await docs.getPage(data.path)?.preload();
    return data;
  },
  head: ({ loaderData, params }) =>
    loaderData
      ? seo({
          title: `${loaderData.title}: iOSOnAnd docs`,
          description: loaderData.description || null,
          path: `/docs${params._splat ? `/${params._splat.replace(/^\/+|\/+$/g, '')}` : ''}`,
          type: 'article',
        })
      : {},
});

function Content({ path }: { path: string }) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`unknown page: ${path}`);
  const { toc } = use(page.load());
  const MDX = page.body;
  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

function DocsRoute() {
  const { path, pageTree } = useFumadocsLoader(Route.useLoaderData());
  return (
    // The app's ThemeProvider (src/routes/__root.tsx) already owns the theme.
    <RootProvider theme={{ enabled: false }} search={{ options: { api: '/docs/search' } }}>
      <div className="docs-shell">
        <DocsLayout tree={pageTree} nav={{ title: 'iOSOnAnd docs', url: '/docs' }} themeSwitch={{ enabled: false }}>
          <Suspense>
            <Content path={path} />
          </Suspense>
        </DocsLayout>
      </div>
    </RootProvider>
  );
}

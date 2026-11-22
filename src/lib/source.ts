// src/lib/source.ts: the Fumadocs content source for /docs.
//
// content/docs/*.mdx is compiled to JS at build time by the fumadocs-mdx Vite
// plugin (vite.config.ts), through the `defineDocs` macro below. Nothing reads
// the filesystem at request time, so this runs in the Workers runtime.
// `async: true` keeps each page's compiled body in its own chunk, loaded when
// the page renders.

import { loader } from 'fumadocs-core/source';
import { defineDocs } from 'fumadocs-mdx/macro';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: { async: true },
});

export const source = loader({
  source: docs.toFumadocsSource(),
  baseUrl: '/docs',
});

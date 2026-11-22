// GET /cli.mjs — the tracker CLI (the repo's cli.mjs, imported as text at
// build time), so an agent can fetch it with
//   curl -fsSLo cli.mjs https://<tracker>/cli.mjs
// It is zero-dependency Node 18+ code; nothing else is served from here.

import { createFileRoute } from '@tanstack/react-router';
import cliSource from '../../cli.mjs?raw';

export const Route = createFileRoute('/cli.mjs')({
  server: {
    handlers: {
      GET: () =>
        new Response(cliSource, {
          headers: {
            'content-type': 'text/javascript; charset=utf-8',
            'cache-control': 'public, max-age=300',
            'content-disposition': 'inline; filename="cli.mjs"',
            'x-content-type-options': 'nosniff',
          },
        }),
    },
  },
});

// GET /SKILL.md — the drop-in agent skill (the repo's SKILL.md, imported as
// text at build time), so an agent or maintainer can fetch it with
//   curl -fsSLo .claude/skills/iosonand-tracker/SKILL.md https://<tracker>/SKILL.md
// Served from the same version of the tracker as GET /cli.mjs.

import { createFileRoute } from '@tanstack/react-router';
import skillSource from '../../SKILL.md?raw';

export const Route = createFileRoute('/SKILL.md')({
  server: {
    handlers: {
      GET: () =>
        new Response(skillSource, {
          headers: {
            'content-type': 'text/markdown; charset=utf-8',
            'cache-control': 'public, max-age=300',
            'content-disposition': 'inline; filename="SKILL.md"',
            'x-content-type-options': 'nosniff',
          },
        }),
    },
  },
});

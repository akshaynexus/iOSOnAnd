// tests/api/docs.test.ts — content/docs/*.mdx frontmatter and meta.json, with
// no tracker needed. A frontmatter that is not valid YAML (an unquoted ": "
// in a description, say) makes fumadocs-mdx throw at request time and every
// route answer 500; this catches it in the tests instead.

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.join(import.meta.dir, '..', '..', 'content', 'docs');
const pages = readdirSync(DIR).filter((f) => f.endsWith('.mdx'));

describe('docs content', () => {
  test.each(pages)('%s has a valid frontmatter with a quoted title and description', (file) => {
    const src = readFileSync(path.join(DIR, file), 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
    expect(m, `${file}: no frontmatter`).not.toBeNull();
    const fm = Bun.YAML.parse(m![1]) as Record<string, unknown>;
    expect(typeof fm.title, `${file}: title`).toBe('string');
    expect(typeof fm.description, `${file}: description`).toBe('string');
    for (const key of ['title', 'description']) {
      const line = m![1].split('\n').find((l) => l.startsWith(`${key}:`))!;
      expect(line, `${file}: quote the ${key} (a ": " inside it breaks YAML)`).toMatch(new RegExp(`^${key}: ".*"$`));
    }
  });

  test('meta.json lists every page once, and only existing pages', () => {
    const meta = JSON.parse(readFileSync(path.join(DIR, 'meta.json'), 'utf8')) as { pages: string[] };
    expect([...meta.pages].sort()).toEqual(pages.map((p) => p.replace(/\.mdx$/, '')).sort());
  });
});

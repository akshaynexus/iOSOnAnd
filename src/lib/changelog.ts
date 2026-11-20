// src/lib/changelog.ts — append(who, summary) helper + feed reader.
// Every tracker write stamps `updated` (where the table has the column) and
// appends a line here. Appends are best-effort: a broken changelog must never
// fail the write it describes.

import { queryAll, exec } from '@/lib/db';
import type { ChangelogEntry } from '@/lib/types';

export async function appendChangelog(who: string, summary: string): Promise<void> {
  try {
    await exec('INSERT INTO changelog (who, summary) VALUES (?, ?)', [who || '', summary]);
  } catch (e) {
    console.error('changelog append failed:', e);
  }
}

export async function listChangelog(limit = 50): Promise<ChangelogEntry[]> {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return queryAll<ChangelogEntry>('SELECT * FROM changelog ORDER BY id DESC LIMIT ?', [n]);
}

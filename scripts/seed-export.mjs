#!/usr/bin/env node
// Export the local D1 back into seed/seed.json (the reverse of seed/apply.mjs).
//
//   node scripts/seed-export.mjs [--dry-run]
//
// Writes the seeded tables from the local DB (areas, devices, device_status,
// forks, reddit_posts, repo_devices, repo_lineage, lineage_repos) and keeps
// seed.json's other keys (_note, sources, claims ...) as they are. Every row
// of a table has the same keys (seed/apply.mjs takes the columns from row 0).
// Rows that point at other rows by id (repo_devices, repo_lineage) are
// written by repo name, so a fresh DB, whose ids differ, loads them.
// Not exported: accounts, sessions, keys, claims, repo claims, uploads, the
// changelog, and forks.maintainer_* (user ids that a fresh DB does not have).
// Refuses to write when rows of test runs (devices t-*, to-*, walk-*) exist.
// Local only; never touches the remote DB.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'seed', 'seed.json');
const dry = process.argv.includes('--dry-run');
const wrangler = path.join(ROOT, 'node_modules', '.bin', 'wrangler');

function q(sql) {
  const out = execFileSync(wrangler, ['d1', 'execute', 'oneios-tracker', '--local', '--json', '--command', sql], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(out)[0].results;
}

const TABLES = {
  areas: 'SELECT slug, name, notes, scope FROM areas ORDER BY slug',
  devices: `SELECT slug, name, model, soc, repo_kind, status, best_result, notes, base, ios_version,
              image_url, image_credit, image_license, image_source_url, updated FROM devices ORDER BY slug`,
  device_status: 'SELECT device_slug, area_slug, state, detail, source, updated FROM device_status ORDER BY device_slug, area_slug',
  forks: `SELECT repo, device_slug, kind, branch, url, best_result, ported, fork_only, verified, notes, base_project, updated
            FROM forks ORDER BY CASE kind WHEN 'upstream' THEN 0 WHEN 'standalone' THEN 1 ELSE 2 END, repo COLLATE NOCASE`,
  reddit_posts: 'SELECT title, url, published, note, image_url, image_width, image_height FROM reddit_posts ORDER BY id',
  repo_devices: `SELECT f.repo, rd.device_slug, rd.support, v.repo AS via, rd.note, rd.updated
                   FROM repo_devices rd JOIN forks f ON f.id = rd.fork_id LEFT JOIN forks v ON v.id = rd.via_fork_id
                  ORDER BY f.repo COLLATE NOCASE, rd.device_slug`,
  lineage_repos: 'SELECT repo, base_project, repo_exists, description, note FROM lineage_repos ORDER BY repo COLLATE NOCASE',
  repo_lineage: `SELECT COALESCE(f.repo, l.repo) AS repo, COALESCE(b.repo, l.base) AS base, l.relation, l.note, l.source, l.base_exists
                   FROM repo_lineage l LEFT JOIN forks f ON f.id = l.fork_id LEFT JOIN forks b ON b.id = l.base_fork_id
                  ORDER BY 1 COLLATE NOCASE, 2, 3`,
};

const test = q("SELECT slug FROM devices WHERE slug LIKE 't-%' OR slug LIKE 'to-%' OR slug LIKE 'walk-%'");
if (test.length) {
  console.error(`seed-export: test rows present (${test.map((t) => t.slug).join(', ')}); remove them first`);
  process.exit(1);
}

const seed = JSON.parse(readFileSync(SEED, 'utf8'));
const counts = {};
for (const [t, sql] of Object.entries(TABLES)) {
  const rows = q(sql);
  seed[t] = rows;
  counts[t] = rows.length;
}
seed.exported = new Date().toISOString().slice(0, 10);
if (dry) console.log('seed-export (dry run):', counts);
else {
  writeFileSync(SEED, JSON.stringify(seed, null, 1) + '\n');
  console.log('seed-export: wrote', path.relative(ROOT, SEED), counts);
}

// Seed loader: seed/seed.json -> D1.
//
//   node seed/apply.mjs [--local|--remote] [--force|--if-empty]
//
// Default: refuses (exit 1) when the devices table already has rows, so it
// never overwrites edits. --if-empty: the same check, but a non-empty DB is
// a quiet skip with exit 0 (used by `bun run dev` / scripts/setup-local.mjs).
// --force: deletes devices, areas, statuses, forks, posts, repo support rows
// and lineage, then seeds. repo_devices and repo_lineage rows name repos
// (not ids) and are resolved with subqueries, so any DB loads them.
// seed/seed.json is written back from a DB by scripts/seed-export.mjs.
// Uses the project's wrangler (node_modules/.bin), else `bunx wrangler`.
// --remote needs `wrangler login` first. Apply the migrations before seeding.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'oneios-tracker';
const args = new Set(process.argv.slice(2));
const remote = args.has('--remote');
const force = args.has('--force');
const ifEmpty = args.has('--if-empty');
const where = remote ? '--remote' : '--local';
const label = remote ? 'remote' : 'local';

const localBin = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const wrangler = (wargs, opts = {}) =>
  existsSync(localBin)
    ? execFileSync(localBin, wargs, { cwd: ROOT, encoding: 'utf8', ...opts })
    : execFileSync('bunx', ['wrangler', ...wargs], { cwd: ROOT, encoding: 'utf8', ...opts });

const seed = JSON.parse(readFileSync(path.join(ROOT, 'seed', 'seed.json'), 'utf8'));

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};
const insert = (table, rows) => {
  const cols = Object.keys(rows[0]);
  return rows.map((r) => `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => esc(r[c])).join(', ')});`);
};

function query(sql) {
  try {
    const r = wrangler(['d1', 'execute', DB, where, '--json', '--command', sql], { stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(r)?.[0]?.results ?? [];
  } catch (e) {
    const msg = String(e.stdout || '') + String(e.stderr || '') || String(e.message || e);
    if (/no such table/i.test(msg)) {
      console.error(`seed: the ${label} DB has no tables. Apply the migrations first: bun run db:migrate:${label}`);
    } else {
      console.error(`seed: wrangler failed${remote ? ' (for --remote run `wrangler login` first)' : ''}:\n${msg.trim().slice(-800)}`);
    }
    process.exit(1);
  }
}

if (!force) {
  const n = Number(query('SELECT COUNT(*) AS n FROM devices;')[0]?.n ?? 0);
  if (n > 0) {
    if (ifEmpty) {
      console.log(`seed: skipped, the ${label} DB already has ${n} device(s)`);
      process.exit(0);
    }
    console.error(`seed: the devices table already has ${n} row(s); refusing to seed over edits. Use --force to replace.`);
    process.exit(1);
  }
}

const TABLES = ['areas', 'devices', 'device_status', 'forks', 'reddit_posts', 'lineage_repos'];
// Rows that point at forks by repo name (ids differ between databases):
// resolved to ids with subqueries at insert time.
const forkId = (repo) => (repo ? `(SELECT id FROM forks WHERE repo = ${esc(repo)} COLLATE NOCASE)` : 'NULL');
const BY_REPO = {
  repo_devices: (r) =>
    `INSERT INTO repo_devices (fork_id, device_slug, support, via_fork_id, note, updated) VALUES (${forkId(r.repo)}, ${esc(r.device_slug)}, ${esc(r.support)}, ${forkId(r.via)}, ${esc(r.note ?? '')}, ${esc(r.updated ?? new Date().toISOString())});`,
  repo_lineage: (r) =>
    `INSERT INTO repo_lineage (repo, fork_id, base, base_fork_id, relation, note, source, base_exists) VALUES (${esc(r.repo)}, ${forkId(r.repo)}, ${esc(r.base)}, ${forkId(r.base)}, ${esc(r.relation)}, ${esc(r.note ?? '')}, ${esc(r.source ?? '')}, ${esc(r.base_exists ?? 1)});`,
};
const stmts = [];
if (force) {
  stmts.push(
    'DELETE FROM repo_devices;',
    'DELETE FROM repo_lineage;',
    'DELETE FROM lineage_repos;',
    'UPDATE repo_claims SET fork_id = NULL;',
    'UPDATE media SET fork_id = NULL;',
    'DELETE FROM device_status;',
    'DELETE FROM forks;',
    'DELETE FROM reddit_posts;',
    'DELETE FROM areas;',
    'DELETE FROM devices;',
  );
}
for (const t of TABLES) {
  if (seed[t]?.length) stmts.push(...insert(t, seed[t]));
}
for (const [t, row] of Object.entries(BY_REPO)) {
  for (const r of seed[t] ?? []) stmts.push(row(r));
}

const file = path.join(os.tmpdir(), `iosonand-seed-${process.pid}-${Date.now()}.sql`);
writeFileSync(file, stmts.join('\n') + '\n');
try {
  wrangler(['d1', 'execute', DB, where, '--file', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`seed: loaded ${[...TABLES, ...Object.keys(BY_REPO)].map((t) => `${seed[t]?.length ?? 0} ${t}`).join(', ')} into the ${label} DB`);
} catch (e) {
  console.error(`seed: wrangler failed:\n${(String(e.stdout || '') + String(e.stderr || '') || String(e.message)).trim().slice(-800)}`);
  process.exit(1);
} finally {
  try {
    unlinkSync(file);
  } catch { /* already gone */ }
}

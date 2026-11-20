// Seed loader: seed/seed.json -> D1. Fresh databases only (refuses to run
// on a DB that already has devices, unless --force). Usage:
//   node seed/apply.mjs [--local|--remote] [--force]
// Requires: bunx wrangler (auth only needed for --remote).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const remote = args.has('--remote');
const force = args.has('--force');

const seed = JSON.parse(readFileSync(new URL('./seed.json', import.meta.url), 'utf8'));

const esc = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
};

const cols = (rows) => Object.keys(rows[0]);
const insert = (table, rows) =>
  rows.map((r) => `INSERT INTO ${table} (${cols(rows).join(', ')}) VALUES (${cols(rows).map((c) => esc(r[c])).join(', ')});`);

const stmts = [];
if (force) stmts.push('DELETE FROM device_status;', 'DELETE FROM forks;', 'DELETE FROM areas;', 'DELETE FROM devices;');
for (const t of ['areas', 'devices', 'device_status', 'forks', 'reddit_posts']) {
  if (seed[t]?.length) stmts.push(...insert(t, seed[t]));
}

const out = path.join(os.tmpdir(), `iosonand-seed-${Date.now()}.sql`);
writeFileSync(out, stmts.join('\n') + '\n');

const check = (file, sql) => {
  try {
    const r = execFileSync('bunx', ['wrangler', 'd1', 'execute', 'oneios-tracker', ...(remote ? ['--remote'] : ['--local']), '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(r);
  } catch (e) {
    console.error('wrangler check failed. Is wrangler installed? (bun install) For --remote: `wrangler login` first.');
    process.exit(1);
  }
};

if (!force) {
  const res = check(0, 'SELECT COUNT(*) AS n FROM devices;');
  const n = res?.[0]?.results?.[0]?.n ?? 0;
  if (n > 0) {
    console.error(`devices table already has ${n} row(s) — refusing to seed (would clobber edits). Use --force.`);
    process.exit(1);
  }
}

try {
  execFileSync('bunx', ['wrangler', 'd1', 'execute', 'oneios-tracker', ...(remote ? ['--remote'] : ['--local']), '--file', out], { stdio: 'inherit' });
  console.log(`seeded ${stmts.length} statements (${remote ? 'remote' : 'local'} D1)`);
} catch {
  process.exit(1);
}

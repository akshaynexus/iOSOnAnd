#!/usr/bin/env node
// Local dev setup. `bun run dev` runs this before Vite; `bun run setup` runs it alone.
// Every step is idempotent, so it is safe on every start:
//   1. .dev.vars: if missing, copy .dev.vars.example and fill ADMIN_EMAIL and a
//      random ADMIN_PASSWORD (printed once; the file is git-ignored, mode 0600).
//   2. Baseline: a local DB made before D1 migrations were used (tables from
//      `d1 execute --file`, no d1_migrations table) gets 0001/0002 recorded as
//      applied, so `migrations apply` does not re-run their ALTER TABLEs.
//   3. `wrangler d1 migrations apply oneios-tracker --local -y` (picks up any
//      new migrations/NNNN_*.sql).
//   4. Seed only when the devices table is empty (seed/apply.mjs --if-empty).
// Local only. It never touches the remote DB. SKIP_SETUP=1 skips it.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'oneios-tracker';
const log = (m) => console.log(`setup: ${m}`);

if (process.env.SKIP_SETUP === '1') {
  log('skipped (SKIP_SETUP=1)');
  process.exit(0);
}

const localBin = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
if (!existsSync(localBin)) {
  console.error('setup: node_modules/.bin/wrangler is missing. Run `bun install` first.');
  process.exit(1);
}
const wrangler = (args) =>
  execFileSync(localBin, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const errText = (e) => (String(e.stdout || '') + String(e.stderr || '') || String(e.message || e)).trim();

// 1. .dev.vars
const devVars = path.join(ROOT, '.dev.vars');
if (!existsSync(devVars)) {
  const example = readFileSync(path.join(ROOT, '.dev.vars.example'), 'utf8');
  const email = 'admin@iosonand.local';
  const password = randomBytes(18).toString('base64url');
  const filled = example
    .replace(/^ADMIN_EMAIL=.*$/m, `ADMIN_EMAIL=${email}`)
    .replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password}`);
  writeFileSync(devVars, filled, { mode: 0o600 });
  chmodSync(devVars, 0o600);
  log('created .dev.vars with a local admin account (shown once):');
  log(`  email    ${email}`);
  log(`  password ${password}`);
  log('  stored in .dev.vars (git-ignored). `node cli.mjs login --admin` reads it from there.');
} else {
  log('.dev.vars exists, left as is');
}

// 2. Baseline a pre-migrations local DB.
const q = (sql) => {
  const r = wrangler(['d1', 'execute', DB, '--local', '--json', '--command', sql]);
  return JSON.parse(r)?.[0]?.results ?? [];
};
let tables;
try {
  tables = new Set(q("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name));
} catch (e) {
  console.error(`setup: cannot open the local D1 database:\n${errText(e).slice(-800)}`);
  process.exit(1);
}
if (tables.has('devices') && !tables.has('d1_migrations')) {
  const applied = ['0001_init.sql'];
  const userCols = new Set(q("SELECT name FROM pragma_table_info('users')").map((r) => r.name));
  if (userCols.has('email')) applied.push('0002_auth.sql');
  q(
    `CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);` +
      applied.map((n) => `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${n}');`).join(''),
  );
  log(`local DB predates D1 migrations; recorded ${applied.join(', ')} as applied`);
}

// 3. Migrations.
try {
  const r = wrangler(['d1', 'migrations', 'apply', DB, '--local', '-y']);
  const names = [...new Set([...r.matchAll(/(\d{4}_[\w-]+\.sql)/g)].map((m) => m[1]))];
  log(/No migrations to apply/i.test(r) ? 'migrations up to date' : `applied migrations ${names.join(', ') || '(see wrangler output)'}`);
} catch (e) {
  console.error(`setup: \`wrangler d1 migrations apply ${DB} --local\` failed:\n${errText(e).slice(-1500)}`);
  process.exit(1);
}

// 4. Seed if empty.
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'seed', 'apply.mjs'), '--local', '--if-empty'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  process.stdout.write(out);
} catch {
  process.exit(1);
}

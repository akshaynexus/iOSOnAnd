#!/usr/bin/env node
// Find forks of the main projects that carry real work and are not tracked,
// and (with --apply) add the ones that clearly belong to one phone.
//
//   GITHUB_TOKEN=... node scripts/find-forks.mjs [--url https://<tracker>] [--out FILE]
//                    [--roots owner/repo,owner/repo] [--depth 3]
//   node scripts/find-forks.mjs --from FILE [--url ...] [--apply] [--min-commits 5]
//
// Scan: walks the GitHub fork tree of each root (forks of forks too, to
// --depth), keeps the forks pushed after they were forked, and compares their
// branches with the parent's (GitHub compare API) to keep only forks with
// commits of their own. The raw result goes into the report (--out), so
// `--from REPORT` classifies and applies again without calling GitHub.
//
// Classify, for each untracked fork with commits:
//   - copies: forks whose newest own commit is the same (count, date,
//     message) are one port; the oldest fork stands for them
//   - phone: our phone names (whole words) and codenames (scripts/hakios-map.json
//     and scripts/forks-map.json) in the repo name if the fork renamed it, its
//     description unless inherited (shared by more than 3 forks), and the
//     branch with the most own commits
//   - ready: exactly one phone, at least --min-commits (default 5) commits
//
// --apply (admin token: TRACKER_TOKEN, or the CLI's saved token for --url)
// adds forks-map.json's new_devices that have a ready fork, then each ready
// fork as a repo row of its phone: kind fork, verified fork-claim (nobody has
// run it), base_project from its root, the busiest branch, and notes with the
// commit count and the date of the newest commit. No statuses: a fork's
// commits say nothing about what works. The tracker links lineage from the
// GitHub parent itself. Safe to repeat: tracked repos are skipped.
// GitHub allows 5000 requests an hour with a token, 60 without.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const TRACKER = flag('--url', process.env.TRACKER_URL || 'https://hackios.appaiproxy.com').replace(/\/$/, '');
const OUT = flag('--out', 'forks-report.json');
const FROM = flag('--from', null);
const APPLY = argv.includes('--apply');
const MIN_COMMITS = Number(flag('--min-commits', '5'));
const DEPTH = Number(flag('--depth', '3'));
const ROOTS = flag(
  '--roots',
  'dipa-studio/ios-sweet,oosexgang/hakios-xnu-kernel,oosexgang/hackios-xnu-userland,UniXNU/UniXNU,akshaynexus/OneiOS',
).split(',');
const MAX_BRANCH_COMPARES = 6;
const BASE_PROJECT = {
  'dipa-studio/ios-sweet': 'ios-sweet',
  'oosexgang/hakios-xnu-kernel': 'HackiOS',
  'oosexgang/hackios-xnu-userland': 'HackiOS',
  'unixnu/unixnu': 'UniXNU',
  'akshaynexus/oneios': 'OneiOS',
};

const lc = (s) => String(s || '').toLowerCase();
let calls = 0;

// ---------------------------------------------------------------- GitHub

async function gh(p) {
  for (let attempt = 0; ; attempt++) {
    calls++;
    let r;
    try {
      r = await fetch(`https://api.github.com${p}`, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'iosonand-find-forks/1',
          ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
      });
    } catch (e) {
      if (attempt < 2) continue; // timeout or network error: retry
      throw e;
    }
    if (r.status === 404 || r.status === 451) return null;
    if ((r.status === 403 || r.status === 429) && attempt < 3) {
      const reset = Number(r.headers.get('x-ratelimit-reset')) * 1000;
      const wait = r.headers.get('x-ratelimit-remaining') === '0' && reset ? Math.max(reset - Date.now(), 0) + 2000 : 30_000;
      console.error(`GitHub ${r.status}, waiting ${Math.round(wait / 1000)} s`);
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    if (!r.ok) throw new Error(`GitHub ${p}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }
}

async function allPages(p) {
  const out = [];
  for (let page = 1; ; page++) {
    const rows = await gh(`${p}${p.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!rows?.length) break;
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

// ---------------------------------------------------------------- tracker

function token() {
  if (process.env.TRACKER_TOKEN) return process.env.TRACKER_TOKEN;
  try {
    const all = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'iosonand', 'tokens.json'), 'utf8'));
    return all[TRACKER] ?? null;
  } catch {
    return null;
  }
}
const TOKEN = token();
async function api(method, p, body) {
  const r = await fetch(TRACKER + p, {
    method,
    headers: { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const tracked = new Set((await api('GET', '/api/forks?limit=1000')).forks.map((f) => lc(f.repo)));
const devices = (await api('GET', '/api/devices?brief=1&limit=500')).devices;
const deviceSlugs = new Set(devices.map((d) => d.slug));

// ---------------------------------------------------------------- scan

async function scan() {
  const seen = new Map();
  const queue = ROOTS.map((r) => ({ repo: r, depth: 0, root: r }));
  while (queue.length) {
    const { repo, depth, root } = queue.shift();
    const info = await gh(`/repos/${repo}`);
    if (!info?.forks_count) continue;
    const forks = await allPages(`/repos/${repo}/forks?sort=newest`);
    for (const f of forks) {
      if (seen.has(lc(f.full_name))) continue;
      seen.set(lc(f.full_name), {
        repo: f.full_name,
        parent: info.full_name,
        parent_branch: info.default_branch,
        root,
        depth: depth + 1,
        created: f.created_at,
        pushed: f.pushed_at,
        default_branch: f.default_branch,
        description: f.description ?? '',
        stars: f.stargazers_count,
        forks: f.forks_count,
        archived: f.archived,
      });
      if (f.forks_count > 0 && depth + 1 < DEPTH) queue.push({ repo: f.full_name, depth: depth + 1, root });
    }
    console.error(`${repo}: ${forks.length} forks (seen ${seen.size}, ${calls} calls)`);
  }

  const pushed = [...seen.values()].filter((f) => Date.parse(f.pushed) > Date.parse(f.created) + 60_000);
  console.error(`${seen.size} forks, ${pushed.length} pushed after forking`);

  const parentBranches = new Map();
  const branchesOf = async (repo) => {
    if (!parentBranches.has(lc(repo))) parentBranches.set(lc(repo), (await allPages(`/repos/${repo}/branches`)) ?? []);
    return parentBranches.get(lc(repo));
  };
  const out = [];
  let done = 0;
  const check = async (f) => {
    try {
      const branches = await allPages(`/repos/${f.repo}/branches`);
      const parentHeads = new Map((await branchesOf(f.parent)).map((b) => [b.name, b.commit.sha]));
      const changed = branches.filter((b) => parentHeads.get(b.name) !== b.commit.sha);
      const [owner] = f.repo.split('/');
      const ahead = [];
      for (const b of changed.slice(0, MAX_BRANCH_COMPARES)) {
        const base = parentHeads.has(b.name) ? b.name : f.parent_branch;
        // per_page=1: the count and the newest commit, not the whole diff.
        const cmp = await gh(`/repos/${f.parent}/compare/${encodeURIComponent(base)}...${owner}:${encodeURIComponent(b.name)}?per_page=1`);
        if (cmp?.ahead_by > 0) {
          const last = cmp.commits?.at(-1)?.commit;
          ahead.push({ branch: b.name, ahead: cmp.ahead_by, last: last?.committer?.date?.slice(0, 10) ?? null, message: last?.message?.split('\n')[0]?.slice(0, 100) ?? '' });
        }
      }
      if (ahead.length) out.push({ ...f, ahead, commits_ahead: Math.max(...ahead.map((a) => a.ahead)), branches: branches.map((b) => b.name) });
    } catch (e) {
      out.push({ ...f, error: String(e.message || e) });
    } finally {
      if (++done % 50 === 0) console.error(`checked ${done}/${pushed.length} (${out.length} with commits, ${calls} calls)`);
    }
  };
  const work = [...pushed];
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (work.length) await check(work.shift());
  }));
  return { forks_seen: seen.size, pushed_after_fork: pushed.length, forks: out };
}

const raw = FROM ? JSON.parse(fs.readFileSync(FROM, 'utf8')).raw : await scan();

// ---------------------------------------------------------------- classify

const hakiosMap = JSON.parse(fs.readFileSync(path.join(HERE, 'hakios-map.json'), 'utf8'));
const forksMap = JSON.parse(fs.readFileSync(path.join(HERE, 'forks-map.json'), 'utf8'));
const codenames = new Map([...Object.entries(hakiosMap.codenames), ...Object.entries(forksMap.codenames)].map(([c, s]) => [lc(c), s]));
const newDevices = new Map(forksMap.new_devices.map((d) => [d.slug, d]));
const skipTokens = new Set(forksMap.skip_tokens.map(lc));
const NOISE = new Set(['xnu', 'kernel', 'hackios', 'hakios', 'port', 'main', 'ios', 'test', 'common', 'master', 'darwin', 'sweet', 'unixnu', 'oneios', 'userland', 'dev', 'wip', 'fork', 'iphone', 'android', 'new', 'fix', 'patch', 'build', 'codex', 'ci', 'log', 'logs', 'experiment', 'integrate', 'device', 'boot', 'display', 'debug', 'feature', 'feat', 'update', 'upstream', 'rebase', ...skipTokens]);

const norm = (t) => lc(t).replace(/[^a-z0-9]+/g, ' ').trim();
const phoneNames = [];
for (const d of [...devices, ...forksMap.new_devices]) {
  for (const n of new Set([norm(d.name), norm(d.name.replace(/^(samsung\s+)?galaxy\s+|^google\s+/i, ''))])) {
    if (n.length >= 5) phoneNames.push([n, d.slug]);
  }
}
phoneNames.sort((a, b) => b[0].length - a[0].length);

function phonesIn(texts) {
  const found = [];
  for (const t of texts) {
    let s = ` ${norm(t)} `;
    for (const [n, slug] of phoneNames) {
      if (s.includes(` ${n} `)) {
        if (!found.includes(slug)) found.push(slug);
        s = s.replaceAll(` ${n} `, ' ');
      }
    }
    for (const tok of s.split(' ')) {
      const slug = codenames.get(tok);
      if (tok && !NOISE.has(tok) && slug && !found.includes(slug)) found.push(slug);
    }
  }
  return found;
}

// Copies are grouped over every fork with commits, tracked or not, so a group
// with one tracked member is skipped as a whole (a rerun adds nothing new).
const withCommits = raw.forks.filter((f) => !f.error);
const descCount = new Map();
for (const f of raw.forks) {
  const d = (f.description || '').trim();
  if (d) descCount.set(d, (descCount.get(d) ?? 0) + 1);
}
const inherited = (d) => !d || (descCount.get(d) ?? 0) > 3;

const groups = new Map();
for (const f of withCommits) {
  const top = [...f.ahead].sort((a, b) => b.ahead - a.ahead)[0];
  const key = `${top.ahead}|${top.last}|${top.message}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ ...f, top });
}
const ports = [...groups.values()].filter((g) => !g.some((f) => tracked.has(lc(f.repo)))).map((g) => {
  g.sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
  const f = g[0];
  const desc = (f.description || '').trim();
  // A fork keeps its parent's name and description unless its owner changes
  // them, so only a renamed repo, an own description and the busiest branch
  // (where the fork's work is) say which phone it is for.
  const name = f.repo.split('/')[1];
  const renamed = lc(name) !== lc(f.parent.split('/')[1]);
  const phones = phonesIn([renamed ? name : '', inherited(desc) ? '' : desc, f.top.branch]);
  return { ...f, copies: g.slice(1).map((x) => x.repo), phones };
});
const ready = ports.filter((p) => p.phones.length === 1 && p.commits_ahead >= MIN_COMMITS);
ready.sort((a, b) => a.phones[0].localeCompare(b.phones[0]) || b.commits_ahead - a.commits_ahead);

// ---------------------------------------------------------------- apply

const applied = { devices: [], forks: [], skipped: [], errors: [] };
if (APPLY) {
  if (!TOKEN) throw new Error(`no token for ${TRACKER}: set TRACKER_TOKEN or run node ./cli.mjs login --admin`);
  const me = await api('GET', '/api/auth/me');
  if (!me.is_admin) throw new Error('--apply needs an admin token');
  for (const slug of new Set(ready.map((p) => p.phones[0]))) {
    if (deviceSlugs.has(slug)) continue;
    const d = newDevices.get(slug);
    if (!d) continue;
    try {
      await api('POST', '/api/devices', { slug, name: d.name, model: d.model, soc: d.soc, repo_kind: 'fork', base: 'other', status: 'unknown', notes: `Codename ${d.model}. Added from the fork trees of the main projects (scripts/find-forks.mjs).` });
      deviceSlugs.add(slug);
      applied.devices.push(slug);
    } catch (e) {
      applied.errors.push({ device: slug, error: String(e.message || e) });
    }
  }
  for (const p of ready) {
    const slug = p.phones[0];
    if (!deviceSlugs.has(slug)) {
      applied.skipped.push({ repo: p.repo, why: `phone ${slug} is not tracked and not in forks-map.json new_devices` });
      continue;
    }
    const branch = p.top.branch === p.default_branch ? '' : p.top.branch;
    const notes = `Fork of ${p.parent} with ${p.commits_ahead} commits of its own (newest ${p.top.last}, branch ${p.top.branch}: "${p.top.message}").${p.copies.length ? ` Same work in ${p.copies.length} other fork${p.copies.length === 1 ? '' : 's'}.` : ''} Found in the fork tree of ${p.root}.`;
    try {
      const created = (await api('POST', '/api/forks/sync', { repo: p.repo, device_slug: slug, branch, notes: notes.slice(0, 1000) })).fork;
      const base_project = BASE_PROJECT[lc(p.root)];
      await api('PATCH', `/api/forks/${created.id}`, { kind: 'fork', ...(base_project ? { base_project } : {}) });
      applied.forks.push({ repo: p.repo, device: slug });
    } catch (e) {
      applied.errors.push({ repo: p.repo, error: String(e.message || e) });
    }
  }
}

// ---------------------------------------------------------------- report

const summary = {
  tracker: TRACKER,
  at: new Date().toISOString(),
  roots: ROOTS,
  forks_seen: raw.forks_seen,
  pushed_after_fork: raw.pushed_after_fork,
  untracked_with_commits: withCommits.filter((f) => !tracked.has(lc(f.repo))).length,
  ports_after_collapsing_copies: ports.length,
  one_phone: ports.filter((p) => p.phones.length === 1).length,
  several_phones: ports.filter((p) => p.phones.length > 1).length,
  no_phone: ports.filter((p) => !p.phones.length).length,
  ready: ready.length,
  ready_phones: new Set(ready.map((p) => p.phones[0])).size,
  ...(APPLY ? { devices_added: applied.devices.length, forks_added: applied.forks.length, skipped: applied.skipped.length, errors: applied.errors.length } : {}),
  github_calls: calls,
};
const OUTFILE = FROM && !argv.includes('--out') ? FROM : OUT;
fs.writeFileSync(OUTFILE, JSON.stringify({ summary, raw, ready, review: ports.filter((p) => !ready.includes(p)), applied }, null, 2));

const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 90);
const name = (slug) => devices.find((d) => d.slug === slug)?.name ?? newDevices.get(slug)?.name ?? slug;
const md = [
  `# Untracked forks ready to add (${ready.length}, ${summary.ready_phones} phones)`,
  '',
  `One phone, at least ${MIN_COMMITS} commits of their own. ${summary.forks_seen} forks seen; ${summary.untracked_with_commits} untracked with commits; ${summary.ports_after_collapsing_copies} after collapsing copies.`,
  '',
  '| Phone | Repo | Commits | Newest commit | Branch | Copies |',
  '|---|---|---|---|---|---|',
  ...ready.map((p) => `| ${name(p.phones[0])}${deviceSlugs.has(p.phones[0]) ? '' : ' (new)'} | [${p.repo}](https://github.com/${p.repo}) | ${p.commits_ahead} | ${p.top.last ?? '?'} | ${cell(p.top.branch)} | ${p.copies.length || ''} |`),
].join('\n');
fs.writeFileSync(OUTFILE.replace(/\.json$/, '') + '.md', md + '\n');
console.log(JSON.stringify(summary, null, 2));
if (applied.errors.length) process.exitCode = 1;

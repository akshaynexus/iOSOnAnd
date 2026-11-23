#!/usr/bin/env node
// Combine the HakiOS ports registry (https://hakios-developers.com/#/ports)
// with the tracker.
//
//   node scripts/sync-hakios.mjs            # dry run: print the plan
//   node scripts/sync-hakios.mjs --apply    # write it through the tracker API
//   [--url http://127.0.0.1:3001] [--report FILE] [--registry https://hakios-developers.com]
//
// What it reads (public JSON, no login):
//   GET /api/ports       every approved port: device, codename, SoC, Darwin, status
//                        (home | boots | wip), per-feature states, repo, author
//   GET /api/forks       the GitHub forks of oosexgang/hakios-xnu-kernel, paged
//                        (60 a page), with stars, branch, pushed, active
//
// What it writes (admin token: TRACKER_TOKEN, or the CLI's
// ~/.config/iosonand/tokens.json entry for the tracker URL):
//   - a device for each port codename in scripts/hakios-map.json new_devices;
//     model and SoC on existing devices only where ours are empty
//   - each port's repo as a fork (kind fork when it is a GitHub fork, else
//     standalone; base_project from the map, else HackiOS) and its "based on"
//     row; a repo that already exists keeps its own fields and only gains the
//     device in its supported list
//   - GitHub forks of the HakiOS kernel whose name or branch names a known
//     device codename (the rest of the 400+ forks are empty copies)
//   - per-area states from the port's features, source the port's page:
//       status home -> boot works, boots or wip -> boot in-progress
//       display: implied by boot; touch + buttons -> touch; cellular -> modem;
//       charging -> battery; gpu, wifi, bluetooth, audio by name
//       yes -> works, partial -> in-progress, no -> broken, unknown -> skipped
//     Several ports for one phone: the best state of each area wins.
// A state is written only when our cell is empty or unknown, when it came
// from an earlier run of this sync, or when the registry reports more
// progress (works > in-progress > broken) than a row that is not the
// maintainer's. A maintainer's row (its detail names the maintainer) is never
// changed. Every decision goes to the report (default: hakios-sync-report.json).

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
const APPLY = argv.includes('--apply');
const TRACKER = (flag('--url', process.env.TRACKER_URL || 'http://127.0.0.1:3001')).replace(/\/$/, '');
const REGISTRY = (flag('--registry', 'https://hakios-developers.com')).replace(/\/$/, '');
const REPORT = flag('--report', 'hakios-sync-report.json');
const MAP = JSON.parse(fs.readFileSync(path.join(HERE, 'hakios-map.json'), 'utf8'));
const TAG = 'HakiOS registry';

function token() {
  if (process.env.TRACKER_TOKEN) return process.env.TRACKER_TOKEN;
  try {
    const all = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'iosonand', 'tokens.json'), 'utf8'));
    return all[TRACKER] ?? null;
  } catch {
    return null;
  }
}

async function getJson(url) {
  const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'iosonand-sync/1' } });
  if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
  return r.json();
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

// ---------------------------------------------------------------- helpers

const RANK = { works: 3, 'in-progress': 2, broken: 1, unknown: 0 };
const FEATURE_STATE = { yes: 'works', partial: 'in-progress', no: 'broken' };
const FEATURE_AREA = { gpu: 'gpu', wifi: 'wifi', bluetooth: 'bluetooth', audio: 'audio', cellular: 'modem', charging: 'battery' };

const lc = (s) => String(s || '').toLowerCase();

/** "https://github.com/o/r/tree/b" -> {repo:"o/r", branch:"b"}; several URLs allowed. */
function parseRepos(raw) {
  const out = [];
  for (const m of String(raw || '').matchAll(/https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^\s#?]+))?\/?(?=\s|$)/g)) {
    out.push({ repo: `${m[1]}/${m[2]}`, branch: m[3] ?? '' });
  }
  return out;
}

/** The registry's darwin field mixes iOS and Darwin versions. */
function iosVersion(p, pad) {
  const text = `${p.darwin} ${p.build_name}`;
  const name = pad ? 'iPadOS' : 'iOS';
  const ios = /(?:iOS|iPadOS)\s*([\d.]+)/i.exec(text);
  if (ios) return `${name} ${ios[1]}`;
  const v = /(\d+)(?:\.(\d+))?/.exec(p.darwin || '');
  if (!v) return '';
  const major = Number(v[1]);
  const minor = v[2] ?? '0';
  const saysDarwin = /darwin/i.test(text) || (major >= 19 && major <= 24);
  if (saysDarwin && major >= 10 && major <= 24) return `${name} ${major - 6}${minor === '0' ? '' : `.${minor}`}`;
  return `${name} ${p.darwin.split(/\s/)[0]}`;
}

const portUrl = (p) => `${REGISTRY}/#/port/${p.slug}`;
const isMaintainerRow = (row) => /maintainer/i.test(row?.detail || '');
const isOurRow = (row) => (row?.detail || '').startsWith(TAG);

// ---------------------------------------------------------------- read

const report = { registry: REGISTRY, tracker: TRACKER, applied: APPLY, at: new Date().toISOString(), devices: [], forks: [], statuses: [], skipped: [], errors: [] };

const ports = (await getJson(`${REGISTRY}/api/ports`)).ports.filter((p) => p.state === 'approved' && !MAP.skip_ports.includes(p.slug));
const ghForks = [];
for (let offset = 0; ; offset += 60) {
  const page = await getJson(`${REGISTRY}/api/forks?sort=stars&offset=${offset}`);
  ghForks.push(...page.forks);
  if (!page.forks.length || ghForks.length >= page.total) break;
}
const ghForkSet = new Set(ghForks.map((f) => lc(f.full_name)));
const UPSTREAM = 'oosexgang/hakios-xnu-kernel';

const devices = new Map((await api('GET', '/api/devices?limit=1000')).devices.map((d) => [d.slug, d]));
const forks = (await api('GET', '/api/forks?limit=1000')).forks;
const forkByRepo = new Map(forks.map((f) => [lc(f.repo), f]));

if (APPLY) {
  if (!TOKEN) throw new Error(`no token for ${TRACKER}: set TRACKER_TOKEN or run node ./cli.mjs login --admin`);
  const me = await api('GET', '/api/auth/me');
  if (!me.is_admin) throw new Error('the sync needs an admin token');
}

const slugOf = (codename) => MAP.codenames[lc(codename)];

// ---------------------------------------------------------------- devices

const newDevices = new Map(MAP.new_devices.map((d) => [d.slug, d]));
const portsByDevice = new Map();
for (const p of ports) {
  const slug = slugOf(p.codename);
  if (!slug) {
    report.skipped.push({ port: p.slug, why: `codename ${p.codename} is not in scripts/hakios-map.json codenames` });
    continue;
  }
  if (!devices.has(slug) && !newDevices.has(slug)) {
    report.skipped.push({ port: p.slug, why: `device ${slug} is neither tracked nor in new_devices` });
    continue;
  }
  if (!portsByDevice.has(slug)) portsByDevice.set(slug, []);
  portsByDevice.get(slug).push(p);
}

const bestBoot = (list) => (list.some((p) => p.status === 'home') ? 'works' : 'in-progress');
const bootText = (p) => (p.status === 'home' ? 'boots to the Home Screen' : p.status === 'boots' ? 'boots, not to the Home Screen yet' : 'work in progress');

for (const [slug, list] of portsByDevice) {
  const best = list.find((p) => p.status === 'home') ?? list[0];
  const pad = /pad/i.test(best.device);
  const ios = iosVersion(best, pad);
  const best_result = `${TAG}: ${bootText(best)} (${ios || best.darwin})`;
  const have = devices.get(slug);
  if (!have) {
    const d = newDevices.get(slug);
    const body = {
      slug, name: d.name, model: d.model, soc: d.soc, repo_kind: 'fork', base: 'other',
      status: bestBoot(list), best_result, ios_version: ios,
      notes: [d.notes, `Listed on the HakiOS ports registry: ${list.map(portUrl).join(' ')}`].filter(Boolean).join(' '),
    };
    report.devices.push({ action: 'add', slug, name: d.name });
    if (APPLY) devices.set(slug, (await api('POST', '/api/devices', body)).device ?? { slug, statuses: [] });
    else devices.set(slug, { slug, statuses: [] });
    continue;
  }
  const patch = {};
  const d = newDevices.get(slug);
  if (!have.soc && (d?.soc || best.soc_model)) patch.soc = d?.soc || best.soc_model;
  if (!have.ios_version && ios) patch.ios_version = ios;
  if ((!have.status || have.status === 'unknown') && list.length) patch.status = bestBoot(list);
  if (!have.best_result) patch.best_result = best_result;
  if (Object.keys(patch).length) {
    report.devices.push({ action: 'update', slug, set: patch });
    if (APPLY) await api('PATCH', `/api/devices/${slug}`, patch);
  }
}

// ---------------------------------------------------------------- repos

async function addLineage(fork, repo, info) {
  let base = info?.base;
  let relation = info?.relation;
  let note = info?.note ?? '';
  if (!base && ghForkSet.has(lc(repo))) {
    base = UPSTREAM;
    relation = 'fork-of';
    note = `GitHub fork of ${UPSTREAM}`;
  }
  if (!base) return;
  if ((fork.based_on ?? []).some((b) => lc(b.base) === lc(base))) return;
  report.forks.push({ action: 'lineage', repo, base, relation });
  if (APPLY && fork.id) await api('POST', `/api/forks/${fork.id}/lineage`, { base, relation, note, source: `https://github.com/${repo}` });
  fork.based_on = [...(fork.based_on ?? []), { base, relation }];
}

async function ensureFork({ repo, branch, slug, best_result, notes }) {
  const info = Object.entries(MAP.repos).find(([k]) => lc(k) === lc(repo))?.[1];
  if (info?.missing) {
    report.skipped.push({ repo, why: 'the repo is not public on GitHub (404), so it is not linked' });
    return;
  }
  let fork = forkByRepo.get(lc(repo));
  if (!fork) {
    const kind = info?.kind ?? (ghForkSet.has(lc(repo)) ? 'fork' : 'standalone');
    const base_project = info?.base_project ?? 'HackiOS';
    report.forks.push({ action: 'add', repo, device: slug, kind, base_project });
    if (APPLY) {
      const created = (await api('POST', '/api/forks/sync', { repo, device_slug: slug, branch, best_result, notes })).fork;
      fork = (await api('PATCH', `/api/forks/${created.id}`, { kind, base_project })).fork;
    } else {
      fork = { repo, device_slug: slug, supports: [], based_on: [] };
    }
    forkByRepo.set(lc(repo), fork);
    await addLineage(fork, repo, info);
    return;
  }
  const supported = fork.device_slug === slug || (fork.supports ?? []).some((s) => s.device_slug === slug);
  if (!supported) {
    report.forks.push({ action: 'support', repo, device: slug });
    if (APPLY && fork.id) {
      await api('POST', `/api/forks/${fork.id}/devices`, { device_slug: slug, support: 'claimed', note: `${TAG}: listed as the source of this port` });
    }
    fork.supports = [...(fork.supports ?? []), { device_slug: slug }];
  }
  await addLineage(fork, repo, info);
}

for (const [slug, list] of portsByDevice) {
  for (const p of list) {
    for (const { repo, branch } of parseRepos(p.repo)) {
      try {
        await ensureFork({
          repo, branch, slug,
          best_result: `${TAG}: ${bootText(p)}`,
          notes: `${p.device}${p.build_name ? ` (${p.build_name})` : ''}, Darwin ${p.darwin}, by ${p.author}. Registry page: ${portUrl(p)}`,
        });
      } catch (e) {
        report.errors.push({ repo, device: slug, error: String(e.message || e) });
      }
    }
  }
}

const extra = new Map(MAP.extra_forks.map((f) => [lc(f.repo), f.codename]));
const NOISE = new Set(['xnu', 'kernel', 'hackios', 'hakios', 'port', 'main', 'ios', 'test', 'common', 'master', 'darwin']);
for (const f of ghForks) {
  if (forkByRepo.has(lc(f.full_name))) continue;
  const toks = `${f.name} ${f.branch}`.toLowerCase().split(/[^a-z0-9_]+/).filter((t) => t && !NOISE.has(t));
  const codename = extra.get(lc(f.full_name)) ?? toks.find((t) => slugOf(t));
  const slug = codename && slugOf(codename);
  if (!slug || !devices.has(slug)) continue;
  const pushed = new Date(f.pushed * 1000).toISOString().slice(0, 10);
  try {
    await ensureFork({
      repo: f.full_name, branch: f.branch === 'main' ? '' : f.branch, slug, best_result: '',
      notes: `GitHub fork of ${UPSTREAM} for ${codename}${f.description ? `: ${f.description}` : ''}. Last push ${pushed}${f.active ? '' : ' (inactive)'}, ${f.stars} stars. Listed at ${REGISTRY}/#/fork/${f.full_name}`,
    });
  } catch (e) {
    report.errors.push({ repo: f.full_name, device: slug, error: String(e.message || e) });
  }
}

// ---------------------------------------------------------------- statuses

for (const [slug, list] of portsByDevice) {
  const cells = new Map(); // area -> {state, detail, source}
  const offer = (area, state, detail, p) => {
    const cur = cells.get(area);
    if (!cur || RANK[state] > RANK[cur.state]) cells.set(area, { state, detail, source: portUrl(p) });
  };
  for (const p of list) {
    const who = `${parseRepos(p.repo)[0]?.repo ?? p.author}`;
    offer('boot', p.status === 'home' ? 'works' : 'in-progress', `${TAG}: ${bootText(p)} (${who}, Darwin ${p.darwin})`, p);
    const t = p.features.touch, b = p.features.buttons;
    const tb = [t, b].filter((s) => FEATURE_STATE[s]);
    if (tb.length) {
      const state = tb.every((s) => s === 'yes') ? 'works' : tb.every((s) => s === 'no') ? 'broken' : 'in-progress';
      offer('touch', state, `${TAG}: touch ${t}, buttons ${b} (${who})`, p);
    }
    for (const [feature, area] of Object.entries(FEATURE_AREA)) {
      const s = p.features[feature];
      if (!FEATURE_STATE[s]) continue;
      offer(area, FEATURE_STATE[s], `${TAG}: ${feature} ${s} (${who})`, p);
    }
  }
  const rows = new Map((devices.get(slug)?.statuses ?? []).map((r) => [r.area_slug, r]));
  for (const [area, cell] of cells) {
    const cur = rows.get(area);
    let why;
    if (!cur || cur.state === 'unknown') why = 'empty';
    else if (isMaintainerRow(cur)) why = null;
    else if (isOurRow(cur)) why = cur.state === cell.state && cur.detail === cell.detail ? null : 'resync';
    else if (RANK[cell.state] > RANK[cur.state]) why = `more progress than ${cur.state}`;
    const entry = { device: slug, area, state: cell.state, was: cur ? cur.state : null };
    if (!why) {
      if (cur && !(isOurRow(cur) && cur.state === cell.state)) report.skipped.push({ ...entry, why: isMaintainerRow(cur) ? 'maintainer row' : `kept ours (${cur.state}: ${cur.detail.slice(0, 80)})` });
      continue;
    }
    report.statuses.push({ ...entry, why });
    if (APPLY) {
      try {
        await api('PUT', '/api/status', { device_slug: slug, area_slug: area, ...cell });
      } catch (e) {
        report.errors.push({ device: slug, area, error: String(e.message || e) });
      }
    }
  }
}

// ---------------------------------------------------------------- report

fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
const count = (xs, a) => xs.filter((x) => x.action === a).length;
console.log(JSON.stringify({
  applied: APPLY,
  ports: ports.length,
  github_forks: ghForks.length,
  devices_added: count(report.devices, 'add'),
  devices_updated: count(report.devices, 'update'),
  repos_added: count(report.forks, 'add'),
  repo_devices_added: count(report.forks, 'support'),
  lineage_added: count(report.forks, 'lineage'),
  statuses_written: report.statuses.length,
  skipped: report.skipped.length,
  errors: report.errors.length,
  report: REPORT,
}, null, 2));
if (report.errors.length) process.exitCode = 1;

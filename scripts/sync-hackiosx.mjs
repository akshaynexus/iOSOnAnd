#!/usr/bin/env node
// Combine hackiosx.dev (https://hackiosx.dev/projects) with the tracker.
//
//   node scripts/sync-hackiosx.mjs            # dry run: print the plan
//   node scripts/sync-hackiosx.mjs --apply    # write it through the tracker API
//   [--url http://127.0.0.1:3001] [--report FILE] [--site https://hackiosx.dev]
//
// hackiosx.dev is a hand-written documentation site, not a registry: plain
// HTML, no API. What it reads from GET /projects:
//   - HackiOS, ios-sweet and UniXNU (h2 ids hackios, ios-sweet, unixnu): the
//     "Works" and "Missing" lists
//   - the "Community ports" table: phone (linked to its repo), chip, based on,
//     state
// The site states results in sentences, so scripts/hackiosx-map.json says,
// sentence by sentence, which areas each one supports (checked by hand). A
// sentence the live page no longer has writes nothing; a new or reworded one
// is reported as unmapped and writes nothing until the map covers it.
//
// What it writes (admin token: TRACKER_TOKEN, or the CLI's
// ~/.config/iosonand/tokens.json entry for the tracker URL):
//   - the phones in the map's new_devices; on phones we have, only an empty
//     SoC or best result is filled
//   - each port's repo as a repo row for its phone (new repos from the map's
//     repos, with their "based on" row); a repo we already track keeps its
//     fields and only gains the phone in its supported list
//   - per-area states, source the page's section (badge "hackiosx.dev"). Of
//     several sentences about one cell, the best state wins.
// A state is written only when our cell is empty or unknown, when it came
// from an earlier run of this sync, or when the site reports more progress
// (works > in-progress > broken) than a row that is not the maintainer's. A
// maintainer's row (its detail names the maintainer) is never changed. Every
// decision goes to the report (default: hackiosx-sync-report.json).

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
const TRACKER = flag('--url', process.env.TRACKER_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const SITE = flag('--site', 'https://hackiosx.dev').replace(/\/$/, '');
const REPORT = flag('--report', 'hackiosx-sync-report.json');
const MAP = JSON.parse(fs.readFileSync(path.join(HERE, 'hackiosx-map.json'), 'utf8'));
const TAG = 'hackiosx.dev';

function token() {
  if (process.env.TRACKER_TOKEN) return process.env.TRACKER_TOKEN;
  try {
    const all = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'iosonand', 'tokens.json'), 'utf8'));
    return all[TRACKER] ?? null;
  } catch {
    return null;
  }
}

async function getText(url) {
  const r = await fetch(url, { headers: { accept: 'text/html', 'user-agent': 'iosonand-sync/1' } });
  if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
  return r.text();
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
const lc = (s) => String(s || '').toLowerCase();

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '–', mdash: '—', hellip: '…' };
/** Text of an HTML fragment: tags dropped, entities decoded, spaces collapsed. */
function text(html) {
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
      e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** "https://github.com/o/r/tree/b" -> {repo:"o/r", branch:"b"}, the repo name canonicalised. */
function parseRepo(url) {
  const m = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^\s#?]+))?\/?(?:[#?].*)?$/.exec(url || '');
  if (!m) return null;
  const raw = `${m[1]}/${m[2]}`;
  const alias = Object.entries(MAP.repo_aliases).find(([k]) => lc(k) === lc(raw))?.[1];
  return { repo: alias ?? raw, branch: m[3] ?? '' };
}

/** The <h2 id="..."> sections of the page, as id -> html. */
function sections(html) {
  const out = new Map();
  const parts = html.split(/<h2\b/i).slice(1);
  for (const part of parts) {
    const id = /^[^>]*\bid="([^"]+)"/i.exec(part)?.[1];
    if (id) out.set(id, part);
  }
  return out;
}

/** The <li> texts of the list right after <h3>{title}</h3>. */
function listAfter(sectionHtml, title) {
  const m = new RegExp(`<h3[^>]*>\\s*${title}\\s*</h3>\\s*<ul[^>]*>([\\s\\S]*?)</ul>`, 'i').exec(sectionHtml);
  if (!m) return null;
  return [...m[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((x) => text(x[1]));
}

const isMaintainerRow = (row) => /maintainer/i.test(row?.detail || '');
const isOurRow = (row) => (row?.detail || '').startsWith(TAG);

// ---------------------------------------------------------------- read

const report = { site: SITE, tracker: TRACKER, map_checked: MAP.checked, applied: APPLY, at: new Date().toISOString(), devices: [], forks: [], statuses: [], unmapped: [], gone: [], skipped: [], errors: [] };

const pageUrl = `${SITE}/projects`;
const page = sections(await getText(pageUrl));

const devices = new Map((await api('GET', '/api/devices?limit=1000')).devices.map((d) => [d.slug, d]));
const forks = (await api('GET', '/api/forks?limit=1000')).forks;
const forkByRepo = new Map(forks.map((f) => [lc(f.repo), f]));

if (APPLY) {
  if (!TOKEN) throw new Error(`no token for ${TRACKER}: set TRACKER_TOKEN or run node ./cli.mjs login --admin`);
  const me = await api('GET', '/api/auth/me');
  if (!me.is_admin) throw new Error('the sync needs an admin token');
}

/** device -> area -> {state, detail, source}: the best claim per cell. */
const claims = new Map();
function claim(slug, area, state, detail, source) {
  if (!claims.has(slug)) claims.set(slug, new Map());
  const cells = claims.get(slug);
  const cur = cells.get(area);
  if (!cur || RANK[state] > RANK[cur.state]) cells.set(area, { state, detail, source });
}

/** repo rows to make sure of: {repo, branch, slug, best_result, notes} */
const repoWork = [];
/** phones the page lists, with what the page says about them */
const seen = new Map();

// The three projects: Works / Missing lists.
for (const [id, proj] of Object.entries(MAP.projects)) {
  const html = page.get(id);
  const source = `${pageUrl}#${id}`;
  if (!html) {
    report.gone.push({ project: proj.name, why: `no <h2 id="${id}"> on ${pageUrl}` });
    continue;
  }
  for (const [title, key, verb] of [['Works', 'works', 'works'], ['Missing', 'missing', 'missing']]) {
    const items = listAfter(html, title);
    if (!items) {
      report.gone.push({ project: proj.name, why: `no "${title}" list` });
      continue;
    }
    const known = proj[key];
    for (const item of items) {
      if (!(item in known)) {
        report.unmapped.push({ project: proj.name, list: key, text: item });
        continue;
      }
      for (const [area, state] of known[item]) claim(proj.device, area, state, `${TAG} (${proj.name}): ${verb}: ${item}`, source);
    }
    for (const item of Object.keys(known)) {
      if (!items.includes(item)) report.gone.push({ project: proj.name, list: key, text: item, why: 'no longer on the page; not written' });
    }
  }
  seen.set(proj.device, { name: proj.name });
  for (const repo of proj.repos) repoWork.push({ repo, branch: '', slug: proj.device, best_result: '', notes: '' });
}

// The community ports table.
const portsHtml = page.get('community-ports');
if (!portsHtml) {
  report.gone.push({ table: 'community ports', why: `no <h2 id="community-ports"> on ${pageUrl}` });
} else {
  const rows = [...portsHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]));
  for (const cells of rows) {
    if (cells.length < 4) continue; // the header row uses <th>
    const href = /href="([^"]+)"/i.exec(cells[0])?.[1];
    const phone = text(cells[0]);
    const [chip, basedOn, state] = [text(cells[1]), text(cells[2]), text(cells[3])];
    const parsed = parseRepo(href);
    if (!parsed) {
      report.skipped.push({ phone, why: `no GitHub repo link (${href ?? 'none'})` });
      continue;
    }
    const entry = Object.entries(MAP.ports).find(([k]) => lc(k) === lc(parsed.repo))?.[1];
    if (!entry) {
      report.unmapped.push({ table: 'community ports', phone, repo: parsed.repo, chip, based_on: basedOn, text: state });
      continue;
    }
    if (!devices.has(entry.device) && !MAP.new_devices.some((d) => d.slug === entry.device)) {
      report.skipped.push({ phone, why: `device ${entry.device} is neither tracked nor in new_devices` });
      continue;
    }
    seen.set(entry.device, { phone, chip, state });
    repoWork.push({
      repo: parsed.repo,
      branch: parsed.branch,
      slug: entry.device,
      best_result: `${TAG}: ${state}`,
      notes: `${phone} (${chip}), based on ${basedOn}. Listed at ${pageUrl}#community-ports`,
    });
    if (entry.state !== state) {
      report.unmapped.push({ table: 'community ports', phone, repo: parsed.repo, text: state, was: entry.state, why: 'state text changed; states not written until the map is checked' });
      continue;
    }
    for (const [area, st] of entry.areas) claim(entry.device, area, st, `${TAG} (${parsed.repo}): ${state}`, `${pageUrl}#community-ports`);
  }
}

// ---------------------------------------------------------------- devices

for (const d of MAP.new_devices) {
  if (devices.has(d.slug) || !seen.has(d.slug)) continue;
  const boot = claims.get(d.slug)?.get('boot')?.state ?? 'unknown';
  const s = seen.get(d.slug);
  const body = {
    slug: d.slug, name: d.name, model: d.model, soc: d.soc, repo_kind: 'fork', base: 'other',
    status: boot, best_result: s.state ? `${TAG}: ${s.state}` : '', ios_version: d.ios_version ?? '',
    notes: [d.notes, `Listed on ${pageUrl}`].filter(Boolean).join(' '),
    // the phone's photo, when the map gives one
    ...Object.fromEntries(['image_url', 'image_credit', 'image_license', 'image_source_url'].filter((k) => d[k]).map((k) => [k, d[k]])),
  };
  report.devices.push({ action: 'add', slug: d.slug, name: d.name });
  try {
    if (APPLY) devices.set(d.slug, (await api('POST', '/api/devices', body)).device ?? { slug: d.slug, statuses: [] });
    else devices.set(d.slug, { ...body, statuses: [] });
  } catch (e) {
    report.errors.push({ device: d.slug, error: String(e.message || e) });
  }
}

for (const [slug, s] of seen) {
  const have = devices.get(slug);
  if (!have || !s.state) continue;
  const patch = {};
  if (!have.soc && s.chip) patch.soc = s.chip;
  if (!have.best_result) patch.best_result = `${TAG}: ${s.state}`;
  if (Object.keys(patch).length) {
    report.devices.push({ action: 'update', slug, set: patch });
    if (APPLY) await api('PATCH', `/api/devices/${slug}`, patch);
  }
}

// ---------------------------------------------------------------- repos

async function ensureFork({ repo, branch, slug, best_result, notes }) {
  const info = Object.entries(MAP.repos).find(([k]) => lc(k) === lc(repo))?.[1];
  let fork = forkByRepo.get(lc(repo));
  if (!fork) {
    if (!info) {
      report.skipped.push({ repo, device: slug, why: 'not tracked and not in the map repos; check it on GitHub and add it there' });
      return;
    }
    report.forks.push({ action: 'add', repo, device: slug, kind: info.kind, base_project: info.base_project });
    if (APPLY) {
      const created = (await api('POST', '/api/forks/sync', { repo, device_slug: slug, branch: branch || info.branch || '', best_result, notes })).fork;
      fork = (await api('PATCH', `/api/forks/${created.id}`, { kind: info.kind, base_project: info.base_project })).fork;
    } else {
      fork = { repo, device_slug: slug, supports: [], based_on: [] };
    }
    forkByRepo.set(lc(repo), fork);
    if (info.base && !(fork.based_on ?? []).some((b) => lc(b.base) === lc(info.base))) {
      report.forks.push({ action: 'lineage', repo, base: info.base, relation: info.relation });
      if (APPLY && fork.id) {
        await api('POST', `/api/forks/${fork.id}/lineage`, { base: info.base, relation: info.relation, note: `GitHub fork of ${info.base}`, source: `https://github.com/${repo}` });
      }
    }
    return;
  }
  const supported = fork.device_slug === slug || (fork.supports ?? []).some((s) => s.device_slug === slug);
  if (!supported) {
    report.forks.push({ action: 'support', repo, device: slug });
    if (APPLY && fork.id) {
      await api('POST', `/api/forks/${fork.id}/devices`, { device_slug: slug, support: 'claimed', note: `${TAG}: listed as the source for this phone (${pageUrl})` });
    }
    fork.supports = [...(fork.supports ?? []), { device_slug: slug }];
  }
}

for (const w of repoWork) {
  if (!devices.has(w.slug)) continue;
  try {
    await ensureFork(w);
  } catch (e) {
    report.errors.push({ repo: w.repo, device: w.slug, error: String(e.message || e) });
  }
}

// ---------------------------------------------------------------- statuses

for (const [slug, cells] of claims) {
  if (!devices.has(slug)) continue;
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
    report.statuses.push({ ...entry, why, detail: cell.detail });
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
  phones_on_page: seen.size,
  devices_added: count(report.devices, 'add'),
  devices_updated: count(report.devices, 'update'),
  repos_added: count(report.forks, 'add'),
  repo_devices_added: count(report.forks, 'support'),
  lineage_added: count(report.forks, 'lineage'),
  statuses_written: report.statuses.length,
  unmapped: report.unmapped.length,
  gone: report.gone.length,
  skipped: report.skipped.length,
  errors: report.errors.length,
  report: REPORT,
}, null, 2));
if (report.errors.length) process.exitCode = 1;

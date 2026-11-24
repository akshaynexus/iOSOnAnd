#!/usr/bin/env node
// Bring r/hackios threads into the tracker: new port posts for the Updates
// tab, and the repos porters link in their own threads.
//
//   node scripts/sync-reddit.mjs                     # dry run: print the plan
//   node scripts/sync-reddit.mjs --apply             # write it through the tracker API
//   [--url http://127.0.0.1:3001] [--since 2026-10-01] [--subreddit hackios]
//   [--input DIR] [--report FILE]
//
// What it reads, from Reddit's public JSON (no login):
//   GET /r/<sub>/new.json         posts, newest first, paged back to --since
//                                  (default: 3 days before the newest post the
//                                  tracker has)
//   GET /comments/<id>.json        each post's comment tree (only posts with
//                                  comments)
// Reddit refuses some networks (403 "blocked by network security"); then run
// it from another network, or save those responses and pass --input DIR:
// DIR/posts.json is an array of post objects (Reddit's `data` of each child),
// DIR/comments.json an array of comment objects (with link_id), both the
// shape Reddit's own JSON uses.
//
// Whose words count: the thread's author, in the post and in their own
// comments in it, and anyone linking a repo whose GitHub owner has their
// Reddit name. Repos other people link are only reported.
//
// What it writes (admin token: TRACKER_TOKEN, or the CLI's
// ~/.config/iosonand/tokens.json entry for the tracker URL):
//   - posts: a thread not tracked yet, when its author links a GitHub repo, or
//     it names exactly one tracked phone and has a port flair (PORT_FLAIRS).
//     The note names the phone and the repos; a preview image is kept.
//   - repos: a porter-linked repo that exists on GitHub and is not tracked,
//     for the one phone the thread names (fork-claim, like every repo found
//     through Reddit; kind fork or standalone from GitHub; base_project from
//     the GitHub fork root). A tracked repo gains that phone in its supported
//     list (claimed) when the thread names it. The tracker links lineage from
//     the GitHub parent and README itself.
//   - states: never. A porter's prose needs a person to read it; the report
//     lists, per phone, the threads and the author's own words, to be written
//     as `reddit claim (YYYY-MM-DD): ...` rows with `node cli.mjs status-set`.
// Every decision goes to the report (default: reddit-sync-report.json).
// GITHUB_TOKEN, when set, raises GitHub's rate limit for the repo checks.

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
const SUB = flag('--subreddit', 'hackios');
const INPUT = flag('--input', null);
const REPORT = flag('--report', 'reddit-sync-report.json');
const SINCE_ARG = flag('--since', null);
const TAG = 'reddit claim';
const UA = 'iosonand-tracker-sync/1.0 (community device-status tracker)';
const PORT_FLAIRS = /port|release|showcase|progress|news|project|update/i;
/** Phone makers: a title naming one but no tracked phone is about a phone we do not track. */
const MAKERS = /\b(samsung|galaxy|pixel|redmi|poco|xiaomi|oneplus|moto(rola)?|nokia|realme|oppo|vivo|infinix|tecno|lg|sony|xperia|huawei|honor|nothing phone|asus|rog phone|zte|nubia|lenovo|meizu|iqoo|fairphone)\b/i;
/** Repos that are tools or upstreams, not one phone's port. */
const NOT_A_PORT = new Set(['dipa-studio/ios-sweet', 'oosexgang/hakios-xnu-kernel', 'oosexgang/hackios-xnu-userland', 'unixnu/unixnu', 'akshaynexus/oneios']);
/** GitHub fork roots -> base_project. */
const ROOTS = {
  'dipa-studio/ios-sweet': 'ios-sweet',
  'oosexgang/hakios-xnu-kernel': 'HackiOS',
  'unixnu/unixnu': 'UniXNU',
  'akshaynexus/oneios': 'OneiOS',
};

if (!/^[A-Za-z0-9_]{1,21}$/.test(SUB)) throw new Error(`bad --subreddit ${SUB}`);

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reddit(p) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`https://www.reddit.com${p}`, { headers: { 'user-agent': UA, accept: 'application/json' } });
    const type = r.headers.get('content-type') || '';
    if (r.status === 429 && attempt < 3) {
      await sleep(10_000 * (attempt + 1));
      continue;
    }
    if (!r.ok || !type.includes('json')) {
      throw new Error(
        `GET reddit.com${p}: ${r.status}${type.includes('json') ? '' : ' (not JSON)'}. Reddit may refuse this network; ` +
          'run from another network, or save the responses and pass --input DIR (see the header of this script).',
      );
    }
    await sleep(1100); // about one request a second
    return r.json();
  }
}

const ghCache = new Map();
async function github(repo) {
  if (ghCache.has(repo.toLowerCase())) return ghCache.get(repo.toLowerCase());
  const r = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': UA, ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
  });
  let out = null;
  if (r.ok) {
    const j = await r.json();
    const root = (j.source?.full_name || j.parent?.full_name || '').toLowerCase();
    out = { repo: j.full_name, fork: !!j.fork, parent: j.parent?.full_name ?? null, root, branch: j.default_branch };
  } else if (r.status !== 404) {
    throw new Error(`GitHub ${repo}: ${r.status} ${(await r.text()).slice(0, 120)}`);
  }
  ghCache.set(repo.toLowerCase(), out);
  return out;
}

// ---------------------------------------------------------------- helpers

const lc = (s) => String(s || '').toLowerCase();
const day = (utc) => new Date(utc * 1000).toISOString().slice(0, 10);
const permalink = (p) => `https://www.reddit.com${p.permalink.replace(/\/$/, '')}`;
const canonicalUrl = (u) => u.replace(/^https?:\/\/(old\.|np\.)?reddit\.com/i, 'https://www.reddit.com').replace(/[?#].*$/, '').replace(/\/$/, '');

/** GitHub repos named in text, as {repo, branch}; site paths (orgs, settings) skipped. */
function repos(text) {
  const out = new Map();
  const SKIP = new Set(['orgs', 'settings', 'features', 'sponsors', 'marketplace', 'topics', 'apps', 'login', 'about', 'pricing']);
  for (const m of String(text || '').matchAll(/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})(?:\/tree\/([^\s)\]>"'#?]+))?/g)) {
    const owner = m[1];
    const name = m[2].replace(/\.git$/, '').replace(/[.,;:]+$/, '');
    if (SKIP.has(lc(owner)) || !name) continue;
    const repo = `${owner}/${name}`;
    if (!out.has(lc(repo))) out.set(lc(repo), { repo, branch: m[3] ?? '' });
  }
  return [...out.values()];
}

/** Phone names to match: our device names (with and without maker prefixes), models and codenames. */
function phoneMatcher(devices) {
  const names = new Map(); // phrase -> slug
  const add = (phrase, slug) => {
    const p = lc(phrase).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
    if (p.length >= 4 && !names.has(p)) names.set(p, slug);
  };
  for (const d of devices) {
    for (const part of String(d.name).split(/\s*\/\s*/)) {
      add(part, d.slug);
      add(part.replace(/^(samsung\s+)?galaxy\s+/i, 'galaxy '), d.slug);
      add(part.replace(/^(samsung\s+galaxy|galaxy|google|xiaomi|samsung)\s+/i, ''), d.slug);
      add(part.replace(/\s+5g$/i, ''), d.slug);
    }
  }
  const map = JSON.parse(fs.readFileSync(path.join(HERE, 'hakios-map.json'), 'utf8'));
  const codenames = Object.entries(map.codenames).filter(([, slug]) => devices.some((d) => d.slug === slug));
  const phrases = [...names.keys()].sort((a, b) => b.length - a.length);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![a-z0-9])(${phrases.map(esc).join('|')})(?![a-z0-9+])`, 'g');
  const codeRe = new RegExp(`(?<![a-z0-9])(${codenames.map(([c]) => esc(c)).join('|')})(?![a-z0-9])`, 'g');
  const code = new Map(codenames);
  const byName = (text) => {
    const found = new Set();
    for (const m of lc(text).replace(/[()]/g, ' ').matchAll(re)) found.add(names.get(m[1]));
    return [...found];
  };
  // Codenames are short and often plain words (sweet, munch, lisa), so they
  // count only inside a porter's repo name, e.g. hakios-xnu-kernel-munch.
  const byRepoName = (repoNames) => {
    const found = new Set();
    for (const r of repoNames) for (const m of lc(r.split('/')[1] ?? '').replace(/[_.]/g, '-').matchAll(codeRe)) found.add(code.get(m[1]));
    return [...found];
  };
  /**
   * The phones a thread is about: named in the title, else in the body, else a
   * codename in a porter repo's name. A title that names a phone maker but no
   * tracked phone is about a phone we do not have (a body often names the
   * phone the port started from), so it matches nothing and is reported.
   */
  return ({ title, body, repoNames }) => {
    const inTitle = byName(title);
    if (inTitle.length) return { phones: inTitle };
    if (MAKERS.test(title)) return { phones: [], untracked: title };
    for (const found of [byName(body), byRepoName(repoNames)]) if (found.length) return { phones: found };
    return { phones: [] };
  };
}

// ---------------------------------------------------------------- read

const report = { subreddit: SUB, tracker: TRACKER, applied: APPLY, at: new Date().toISOString(), posts: [], forks: [], claims_to_review: [], repos_mentioned: [], skipped: [], errors: [] };

const devices = (await api('GET', '/api/devices?limit=1000')).devices;
const deviceBySlug = new Map(devices.map((d) => [d.slug, d]));
const forks = (await api('GET', '/api/forks?limit=1000')).forks;
const forkByRepo = new Map(forks.map((f) => [lc(f.repo), f]));
const tracked = (await api('GET', '/api/posts?limit=500')).posts;
const trackedUrls = new Set(tracked.map((p) => canonicalUrl(p.url)));
const newest = tracked.map((p) => p.published).sort().pop();
const since = SINCE_ARG ?? (newest ? new Date(Date.parse(newest) - 3 * 86400_000).toISOString().slice(0, 10) : '2026-10-01');
const sinceUtc = Date.parse(`${since}T00:00:00Z`) / 1000;

if (APPLY) {
  if (!TOKEN) throw new Error(`no token for ${TRACKER}: set TRACKER_TOKEN or run node ./cli.mjs login --admin`);
  const me = await api('GET', '/api/auth/me');
  if (!me.is_admin) throw new Error('the sync needs an admin token');
}

let posts = [];
let comments = [];
if (INPUT) {
  posts = JSON.parse(fs.readFileSync(path.join(INPUT, 'posts.json'), 'utf8')).map((p) => p.data ?? p);
  const cf = path.join(INPUT, 'comments.json');
  if (fs.existsSync(cf)) comments = JSON.parse(fs.readFileSync(cf, 'utf8')).map((c) => c.data ?? c);
  posts = posts.filter((p) => p.created_utc >= sinceUtc);
} else {
  try {
  let after = null;
  for (;;) {
    const page = await reddit(`/r/${SUB}/new.json?limit=100&raw_json=1${after ? `&after=${after}` : ''}`);
    const kids = page.data.children.map((c) => c.data);
    posts.push(...kids.filter((p) => p.created_utc >= sinceUtc));
    after = page.data.after;
    if (!after || !kids.length || kids[kids.length - 1].created_utc < sinceUtc) break;
  }
  const walk = (node, out) => {
    for (const c of node?.data?.children ?? []) {
      if (c.kind !== 't1') continue;
      out.push(c.data);
      if (c.data.replies) walk(c.data.replies, out);
    }
  };
  for (const p of posts) {
    if (!p.num_comments) continue;
    try {
      const [, tree] = await reddit(`/comments/${p.id}.json?raw_json=1&limit=500`);
      walk(tree, comments);
    } catch (e) {
      report.errors.push({ post: permalink(p), error: String(e.message || e) });
    }
  }
  } catch (e) {
    console.error(`sync-reddit: ${e.message || e}`);
    process.exit(2);
  }
}
const commentsByPost = new Map();
for (const c of comments) {
  const id = String(c.link_id || '').replace(/^t3_/, '');
  if (!commentsByPost.has(id)) commentsByPost.set(id, []);
  commentsByPost.get(id).push(c);
}

const matchPhones = phoneMatcher(devices);

// ---------------------------------------------------------------- threads

const threads = [];
for (const p of posts.sort((a, b) => a.created_utc - b.created_utc)) {
  if (p.removed_by_category || p.author === '[deleted]') continue;
  const url = canonicalUrl(permalink(p));
  const own = (commentsByPost.get(p.id) ?? []).filter((c) => c.author === p.author);
  const porterText = [p.title, p.selftext, p.url_overridden_by_dest ?? p.url, ...own.map((c) => c.body)].join('\n');
  const porterRepos = repos(porterText);
  // Repos others link: kept when the GitHub owner is the commenter (their own repo).
  for (const c of commentsByPost.get(p.id) ?? []) {
    if (c.author === p.author) continue;
    for (const r of repos(c.body)) {
      if (lc(r.repo.split('/')[0]) === lc(c.author)) porterRepos.push(r);
      else report.repos_mentioned.push({ thread: url, by: c.author, repo: r.repo });
    }
  }
  const { phones, untracked } = matchPhones({ title: p.title, body: p.selftext, repoNames: porterRepos.map((r) => r.repo) });
  threads.push({ p, url, phones, untracked, repos: porterRepos, own, flair: p.link_flair_text || '' });
}

// ---------------------------------------------------------------- posts

for (const t of threads) {
  if (trackedUrls.has(t.url)) continue;
  const portRepos = t.repos.filter((r) => !NOT_A_PORT.has(lc(r.repo)));
  const keep = t.phones.length > 0 && (portRepos.length > 0 || (t.phones.length === 1 && PORT_FLAIRS.test(t.flair)));
  if (!keep) {
    const why = t.untracked
      ? `about a phone the tracker does not have (add it with device-add, then rerun)${portRepos.length ? `; links ${portRepos.map((r) => r.repo).join(', ')}` : ''}`
      : !t.phones.length
      ? portRepos.length ? `links ${portRepos.map((r) => r.repo).join(', ')} but names no tracked phone: review by hand` : 'names no tracked phone'
      : t.phones.length > 1 ? `names ${t.phones.length} phones and links no repo` : 'no repo from its author and no port flair';
    report.skipped.push({ thread: t.url, title: t.p.title.slice(0, 100), why });
    continue;
  }
  const phoneNames = t.phones.map((s) => deviceBySlug.get(s)?.name ?? s);
  const note = [phoneNames.join(', '), portRepos.length ? `(${portRepos.map((r) => r.repo + (r.branch ? `, branch ${r.branch}` : '')).join('; ')})` : '', t.flair ? `[${t.flair}]` : '']
    .filter(Boolean)
    .join(' ')
    .slice(0, 1000);
  const img = t.p.preview?.images?.[0]?.resolutions?.find((x) => x.width >= 600) ?? t.p.preview?.images?.[0]?.source;
  const body = {
    title: t.p.title.slice(0, 300),
    url: t.url,
    published: day(t.p.created_utc),
    note,
    ...(img?.url ? { image_url: img.url.replace(/&amp;/g, '&'), image_width: img.width, image_height: img.height } : {}),
  };
  report.posts.push({ action: 'add', ...body });
  if (APPLY) {
    try {
      await api('POST', '/api/posts', body);
    } catch (e) {
      if (!/409/.test(String(e.message))) report.errors.push({ thread: t.url, error: String(e.message || e) });
    }
  }
  trackedUrls.add(t.url);
}

// ---------------------------------------------------------------- repos

for (const t of threads) {
  for (const { repo, branch } of t.repos) {
    if (NOT_A_PORT.has(lc(repo))) continue;
    const slug = t.phones.length === 1 ? t.phones[0] : null;
    let fork = forkByRepo.get(lc(repo));
    try {
      if (!fork) {
        if (!slug) {
          report.skipped.push({ thread: t.url, repo, why: t.untracked ? 'thread is about a phone the tracker does not have' : t.phones.length ? `thread names ${t.phones.length} phones (${t.phones.join(', ')})` : 'thread names no tracked phone' });
          continue;
        }
        const gh = await github(repo);
        if (!gh) {
          report.skipped.push({ thread: t.url, repo, why: 'not on GitHub (404, private or renamed)' });
          continue;
        }
        if (forkByRepo.has(lc(gh.repo))) {
          fork = forkByRepo.get(lc(gh.repo)); // linked under an old name
        } else {
          const kind = gh.fork ? 'fork' : 'standalone';
          const base_project = ROOTS[gh.root] ?? '';
          report.forks.push({ action: 'add', repo: gh.repo, device: slug, kind, base_project, thread: t.url });
          if (APPLY) {
            const created = (await api('POST', '/api/forks/sync', {
              repo: gh.repo,
              device_slug: slug,
              branch: branch || '',
              notes: `${TAG} (${day(t.p.created_utc)}): linked by the porter in ${t.url}`,
            })).fork;
            await api('PATCH', `/api/forks/${created.id}`, { kind, ...(base_project ? { base_project } : {}) });
            fork = created;
          } else {
            fork = { repo: gh.repo, device_slug: slug, supports: [] };
          }
          forkByRepo.set(lc(gh.repo), fork);
          continue;
        }
      }
      if (!slug) continue;
      const supported = fork.device_slug === slug || (fork.supports ?? []).some((s) => s.device_slug === slug);
      if (!supported) {
        report.forks.push({ action: 'support', repo: fork.repo, device: slug, thread: t.url });
        if (APPLY && fork.id) await api('POST', `/api/forks/${fork.id}/devices`, { device_slug: slug, support: 'claimed', note: `${TAG} (${day(t.p.created_utc)}): ${t.url}` });
        fork.supports = [...(fork.supports ?? []), { device_slug: slug }];
      }
    } catch (e) {
      report.errors.push({ thread: t.url, repo, error: String(e.message || e) });
    }
  }
}

// ---------------------------------------------------------------- claims to review

for (const t of threads) {
  if (t.phones.length !== 1) continue;
  const words = [t.p.selftext, ...t.own.map((c) => c.body)].map((s) => String(s || '').trim()).filter(Boolean);
  if (!words.length && !t.repos.length) continue;
  report.claims_to_review.push({
    device: t.phones[0],
    thread: t.url,
    date: day(t.p.created_utc),
    title: t.p.title,
    author_words: words.join('\n---\n').slice(0, 2000),
    write_with: `node cli.mjs status-set ${t.phones[0]} <area> <state> --detail "${TAG} (${day(t.p.created_utc)}): ..." --source "${t.url}"`,
  });
}

// ---------------------------------------------------------------- report

fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
const count = (xs, a) => xs.filter((x) => x.action === a).length;
console.log(JSON.stringify({
  applied: APPLY,
  since,
  threads: threads.length,
  comments: comments.length,
  posts_added: count(report.posts, 'add'),
  repos_added: count(report.forks, 'add'),
  repo_devices_added: count(report.forks, 'support'),
  claims_to_review: report.claims_to_review.length,
  repos_mentioned_by_others: report.repos_mentioned.length,
  skipped: report.skipped.length,
  errors: report.errors.length,
  report: REPORT,
}, null, 2));
if (report.errors.length) process.exitCode = 1;

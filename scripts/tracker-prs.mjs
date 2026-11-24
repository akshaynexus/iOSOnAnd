#!/usr/bin/env node
// Offer tracker support to the repos people have claimed on the tracker: a
// pull request that adds TRACKER.md (how to read and update the phone's page
// with the CLI), an "iOSOnAnd tracker" section in the repo's agent
// instructions (AGENTS.md, CLAUDE.md, .cursorrules, Copilot instructions:
// whichever it has, AGENTS.md when it has none), a Claude Code skill
// (.claude/skills/iosonand-tracker/SKILL.md) and .gitignore lines that keep
// keys, the CLI and the offline queue out of git. The docs run the CLI the
// tracker serves (<site>/cli.mjs), kept outside the repo. No code changes.
//
//   node scripts/tracker-prs.mjs                      # dry run: the plan
//   node scripts/tracker-prs.mjs --apply              # open the pull requests
//   [--url https://hackios.appaiproxy.com] [--repo OWNER/REPO] [--report FILE]
//
// Which repos: claimed on the tracker (they have a maintainer), and the main
// (upstream) repo of every phone someone maintains (a phone claim); on GitHub,
// not archived, not owned by the account `gh` is logged in as. --repo
// OWNER/REPO targets any tracked repo, claimed or not. Skipped when the
// default branch already has TRACKER.md or the skill, or a pull request from
// this account's iosonand-tracker branch is open.
//
// How: the account's fork of the repo (GitHub keeps one fork per network, so
// it may be named after the root, e.g. a fork of ios-sweet), a branch
// iosonand-tracker from the repo's default branch, one commit authored with
// the account's GitHub noreply address, then `gh pr create`. Needs `gh`
// logged in and git. Node builtins only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const APPLY = argv.includes('--apply');
const SITE = flag('--url', process.env.TRACKER_URL || 'https://hackios.appaiproxy.com').replace(/\/+$/, '');
const ONLY = flag('--repo', null);
const REPORT = flag('--report', 'tracker-prs-report.json');
const BRANCH = 'iosonand-tracker';
const TITLE = 'Add iOSOnAnd tracker docs and agent skill';
/** Repos that build from a repo manifest: their files live in .repo/manifests, so the PR says how to expose them. */
const isManifest = (dir) => fs.existsSync(path.join(dir, 'default.xml')) && /<manifest[\s>]/.test(fs.readFileSync(path.join(dir, 'default.xml'), 'utf8'));
/** Areas only OneiOS has. */
const ONEIOS_ONLY = new Set(['ipc', 'kernel-mem', 'return-to-oneui']);

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const gh = (...args) => run('gh', args);
const ghJson = (...args) => JSON.parse(gh(...args) || 'null');
function ghTry(...args) {
  try {
    return ghJson(...args);
  } catch {
    return null;
  }
}
const lc = (s) => String(s || '').toLowerCase();

async function tracker(p) {
  const r = await fetch(SITE + p, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`GET ${p}: ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------- templates

const cliPath = '~/.local/share/iosonand/cli.mjs';
const T = `node ${cliPath}`;

function trackerMd({ repo, device, deviceName, soc, areas, project }) {
  const rows = areas.filter((a) => !ONEIOS_ONLY.has(a.slug)).map((a) => `| ${a.name} | \`${a.slug}\` |`);
  return `# iOSOnAnd tracker

[iOSOnAnd](${SITE}) is a community tracker of which Android phones run iOS
ports and what works on each. Every area of a phone (boot, wifi, gpu, touch,
audio, ...) has a state, a one-line detail and a source link.

This port's page: ${SITE}/device/${device} (${deviceName}${soc ? `, ${soc}` : ''}; device slug \`${device}\`).

${project ? `It is part of ${project.name}, whose page lists every phone and repo built on it: ${project.url}.\n\n` : ''}The tracker is updated with its command-line client, \`cli.mjs\` (Node 18
or newer, no dependencies), served by the tracker at ${SITE}/cli.mjs. This
file covers setup and the commands this repo uses. \`${T} --help\` lists all
of them.

## One-time setup

Keep the CLI outside the repo:

\`\`\`sh
mkdir -p ~/.local/share/iosonand
curl -fsSLo ${cliPath} ${SITE}/cli.mjs
\`\`\`

Point it at the live tracker (without this it talks to \`http://localhost:3000\`).
Add this to your shell profile:

\`\`\`sh
export TRACKER_URL=${SITE}
\`\`\`

Check that it works: \`${T} check\`.

## Signing in

Either of these works. Neither puts anything in the repo.

1. GitHub sign-in through \`gh\` (needs \`gh auth login\` done once):
   \`${T} login\`, then \`${T} whoami\`, which should list \`${device}\`
   among the devices you maintain. The token is saved in
   \`~/.config/iosonand/tokens.json\`.
2. An API key from ${SITE}/profile/keys with the scopes you need
   (\`status:write\` for states, \`media:write\` for photos, \`fork:write\` for
   repo records). Put it in \`TRACKER_TOKEN\`, in your shell profile or in a
   \`.env\` file at the repo root, which \`.gitignore\` excludes. The CLI does
   not read \`.env\` itself: load it with \`set -a; . ./.env; set +a\`.

\`${T} tokens\` shows which token is in use, masked. Writes to \`${device}\`
need an account that maintains it; on a 403, claim the repo with
\`${T} repo-claim ${repo} --device ${device}\`.

## Reading the current state

No sign-in needed:

\`\`\`sh
${T} status-get --device ${device}
${T} status-get --device ${device} --area wifi
${T} areas
\`\`\`

| Area | Slug |
|---|---|
${rows.join('\n')}

## Recording a change

The states are \`works\`, \`in-progress\`, \`broken\` and \`unknown\`. Every write
needs \`--detail\` (what the build, log or test showed) and \`--source\` (a
commit, CI run, log or PR URL):

\`\`\`sh
${T} status-set ${device} boot works \\
  --detail "Boots to the lock screen; swipe unlock reaches the home screen" \\
  --source https://github.com/${repo}/commit/<sha>
${T} status-set ${device} wifi in-progress \\
  --detail "Firmware loads and scans; the interface does not come up (boot log)" \\
  --source https://github.com/${repo}/commit/<sha>
\`\`\`

Replace the text and \`<sha>\` with the real ones, then read it back with
\`status-get --device ${device} --area <slug>\`.

## Photos and clips

\`\`\`sh
${T} update ${device} home-screen.jpg clip.mp4 --text "What changed" --area touch
\`\`\`

Crop or blur anything that shows an IMEI, serial number or personal data
first.

## Working offline

\`${T} queue status-set ${device} ...\` appends the command to
\`./TRACKER_QUEUE.md\` (git-ignored); \`${T} flush\` sends the queue later.
Do not put \`--token\` on a queued command.

## Honesty rules

- Record only what a build, log, test or capture shows, and cite it in
  \`--source\`.
- What has not been shown on the phone stays \`unknown\`; code that builds but
  has not run on the phone is at most \`in-progress\`.
- Never lower someone else's state without evidence that it no longer holds.
- Keys and tokens never go in git, a commit or a \`--detail\` text.
`;
}

function agentSection({ device }) {
  return `## iOSOnAnd tracker

This port is tracked at ${SITE}/device/${device} (slug \`${device}\`).
When a change makes an area work, or breaks one that worked, update the
tracker in the same session. Details and examples are in \`TRACKER.md\`.

- CLI: \`${T}\` (from ${SITE}/cli.mjs) with \`TRACKER_URL=${SITE}\`. Never download it into the repo.
- Read first: \`status-get --device ${device}\`, and \`areas\` for the exact slug.
- Record: \`status-set ${device} <area> <works|in-progress|broken|unknown> --detail "<what the build, log or test showed>" --source <commit, CI run or log URL>\`, then read it back.
- Say which system it was on: \`--os ios\` (the default; iPadOS too), \`--os macos\` or \`--os tvos\`, with \`--version "<e.g. iOS 27.2>"\`.
- Auth comes from \`TRACKER_TOKEN\` or the CLI's saved login (\`login\`). Never
  write a key into a file in the repo, a commit or a \`--detail\`.
- Only record what was observed on the phone or in CI; unproven stays
  \`unknown\`. Do not lower someone else's state without evidence.
- Offline: \`queue status-set ...\` now, \`flush\` later.
`;
}

function skillMd({ device, deviceName }) {
  return `---
name: iosonand-tracker
description: Update the iOSOnAnd tracker (${new URL(SITE).host}, device ${device}) with evidence. Use when a change to this port makes a phone feature work (boot, touch, gpu, wifi, audio, ...) or breaks one, or when asked to sync, update or push progress to the tracker.
---

# Update the iOSOnAnd tracker for ${deviceName}

Device slug: \`${device}\`. Page: ${SITE}/device/${device}.
Full guide: \`TRACKER.md\` at the repo root.

Below, \`T\` stands for \`${T}\`, run with \`TRACKER_URL=${SITE}\` set.

1. **CLI.** If \`${cliPath}\` is missing, fetch it from the tracker (never into the repo):
   \`mkdir -p ~/.local/share/iosonand && curl -fsSLo ${cliPath} ${SITE}/cli.mjs\`.
   Run \`T check\`.
2. **Auth.** \`T whoami\` must show a login that maintains \`${device}\`. The
   token comes from \`TRACKER_TOKEN\` or the CLI's saved login. If neither
   exists, ask the user to run \`T login\` (GitHub via \`gh\`) or to set
   \`TRACKER_TOKEN\`. Never open, print, create or commit a file that holds a key.
3. **Current state.** \`T status-get --device ${device}\`.
4. **Map the change to areas.** \`T areas\` for the exact slugs. Pick the state
   from the evidence: \`works\` shown working on the phone; \`in-progress\`
   partly working, or built but not yet run; \`broken\` shown failing or a
   regression; \`unknown\` nothing proven. Do not upgrade on a guess, and do
   not lower someone else's state without evidence.
5. **Record.** One call per area:
   \`T status-set ${device} <area> <state> --detail "<what the build, log or test showed>" --source <commit, CI run, log or PR URL>\`,
   then read it back with \`T status-get --device ${device} --area <area>\`.
   If the tracker is unreachable: \`T queue status-set ...\`, then \`T flush\` later.
6. **Media (optional).** \`T update ${device} <file> ... --text "what changed" --area <area>\`.
   Crop out IMEI, serial numbers and personal data first.
7. **Report back.** Each area changed (old state to new), the detail and
   source used, anything queued, and any 401/403 with the CLI's hint.
`;
}

const GITIGNORE = ['.env', '.env.*', 'cli.mjs', 'TRACKER_QUEUE.md'];

function prBody({ device, files }) {
  return `This adds instructions for keeping this port's page on the [iOSOnAnd tracker](${SITE}) up to date, so you (or your coding agent) can record what works as you go.

${files.map((f) => `- \`${f.path}\`: ${f.why}`).join('\n')}

The tracker key never goes into git: sign-in is through \`gh\`, or a key in \`TRACKER_TOKEN\`/a git-ignored \`.env\`. No code changes.

Tracker page: ${SITE}/device/${device}`;
}

// ---------------------------------------------------------------- plan

const me = ghJson('api', 'user');
const noreply = `${me.id}+${me.login}@users.noreply.github.com`;
const author = me.name || me.login;
const areas = (await tracker('/api/areas')).areas;
const forks = (await tracker('/api/forks?limit=1000')).forks;
const report = { site: SITE, applied: APPLY, as: me.login, at: new Date().toISOString(), opened: [], planned: [], skipped: [], errors: [] };

// Phones someone maintains (an approved phone claim).
const maintainedPhones = new Set(
  (await tracker('/api/devices?limit=1000')).devices.filter((d) => (d.maintainers ?? []).length > 0).map((d) => d.slug),
);
const notMine = (f) => lc(f.repo.split('/')[0]) !== lc(me.login);
const claimed = ONLY
  ? forks.filter((f) => lc(f.repo) === lc(ONLY) && notMine(f))
  : forks.filter(
      (f) => notMine(f) && ((f.maintainers?.length || f.maintainer_user_id) || (f.kind === 'upstream' && f.device_slug && maintainedPhones.has(f.device_slug))),
    );
if (ONLY && !claimed.length) throw new Error(`${ONLY} is not on the tracker (or it is your own repo)`);

const exists = (repo, p, ref) => ghTry('api', `repos/${repo}/contents/${p}?ref=${encodeURIComponent(ref)}`) !== null;

for (const f of claimed) {
  const repo = f.repo;
  try {
    const gr = ghTry('api', `repos/${repo}`);
    if (!gr) {
      report.skipped.push({ repo, why: 'not on GitHub (404, private or renamed)' });
      continue;
    }
    if (gr.archived) {
      report.skipped.push({ repo, why: 'archived' });
      continue;
    }
    const base = gr.default_branch;
    if (exists(repo, 'TRACKER.md', base) || exists(repo, '.claude/skills/iosonand-tracker/SKILL.md', base)) {
      report.skipped.push({ repo, why: 'already has the tracker docs' });
      continue;
    }
    const open = ghJson('pr', 'list', '--repo', repo, '--author', me.login, '--state', 'open', '--json', 'url,headRefName,title');
    const mine = open.find((p) => p.headRefName === BRANCH || p.title === TITLE);
    if (mine) {
      report.skipped.push({ repo, why: `pull request already open: ${mine.url}` });
      continue;
    }
    const device = f.device_slug;
    if (!device) {
      report.skipped.push({ repo, why: 'no phone on the tracker' });
      continue;
    }
    const d = await tracker(`/api/devices/${encodeURIComponent(device)}`);
    const dev = d.device ?? d;
    const family = f.base_project || '';
    const project = family ? { name: family, url: `${SITE}/?tab=repos&family=${encodeURIComponent(family)}` } : null;
    const ctx = { repo, device, deviceName: dev.name || device, soc: dev.soc || '', areas, project };

    // Which agent files the repo uses: the section goes into each; AGENTS.md when it has none.
    const agentFiles = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', '.github/copilot-instructions.md'].filter((p) => exists(repo, p, base));
    const plan = { repo, device, base, agent_files: agentFiles.length ? agentFiles : ['AGENTS.md (new)'] };
    report.planned.push(plan);
    if (!APPLY) continue;

    // The account's fork (an existing one in the network is returned as is).
    const fork = ghJson('api', '-X', 'POST', `repos/${repo}/forks`).full_name;
    for (let i = 0; i < 20 && !ghTry('api', `repos/${fork}`); i++) await new Promise((r) => setTimeout(r, 3000));

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-pr-'));
    try {
      run('git', ['clone', '--depth', '1', '--branch', base, `https://github.com/${repo}.git`, dir]);
      const g = (...args) => run('git', ['-C', dir, ...args]);
      g('checkout', '-b', BRANCH);
      const write = (p, text) => {
        fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
        fs.writeFileSync(path.join(dir, p), text);
      };
      const files = [];
      write('TRACKER.md', trackerMd(ctx));
      files.push({ path: 'TRACKER.md', why: "how to read and update this phone's page with the tracker CLI (setup outside the repo, sign-in, status-set with evidence, photos, offline queue, honesty rules)" });
      for (const p of agentFiles.length ? agentFiles : ['AGENTS.md']) {
        const full = path.join(dir, p);
        const had = fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
        write(p, had ? `${had.replace(/\s*$/, '')}\n\n${agentSection(ctx)}` : `# Agent instructions\n\n${agentSection(ctx)}`);
        files.push({ path: p, why: `${had ? 'adds' : 'new, with'} an "iOSOnAnd tracker" section so coding agents record what starts working or breaks, in the same session` });
      }
      write('.claude/skills/iosonand-tracker/SKILL.md', skillMd(ctx));
      files.push({ path: '.claude/skills/iosonand-tracker/SKILL.md', why: 'a Claude Code skill with the step-by-step update' });
      const gi = path.join(dir, '.gitignore');
      const had = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
      const missing = GITIGNORE.filter((l) => !had.split('\n').map((x) => x.trim()).includes(l));
      if (missing.length) {
        write('.gitignore', `${had.replace(/\s*$/, '')}${had ? '\n\n' : ''}# iOSOnAnd tracker: local keys, the CLI and the offline queue stay out of git\n${missing.join('\n')}\n`);
        files.push({ path: '.gitignore', why: `keeps ${missing.join(', ')} out of git` });
      }
      g('add', '-A');
      g('-c', `user.name=${author}`, '-c', `user.email=${noreply}`, 'commit', '-q', '-m', 'docs: add iOSOnAnd tracker guide, agent instructions and Claude Code skill', '-m', `TRACKER.md explains how to keep ${SITE}/device/${device} up to date with the tracker CLI (${SITE}/cli.mjs). The agent instructions and the skill in .claude/skills/iosonand-tracker tell coding agents to record what starts working or breaks, with evidence. .gitignore keeps keys, the CLI and the offline queue out of git. No code changes.`);
      run('git', ['-C', dir, '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', '--force', `https://github.com/${fork}.git`, `HEAD:refs/heads/${BRANCH}`]);
      const extra = isManifest(dir)
        ? `\n\nThis is a repo manifest, so after \`repo sync\` these files sit in \`.repo/manifests\`. To put them at the top of the tree, where coding agents start, a \`<linkfile>\` for \`AGENTS.md\`, \`TRACKER.md\` and \`.claude\` in \`default.xml\` would do it; left to you, so this PR changes no build files.`
        : '';
      const url = gh('pr', 'create', '--repo', repo, '--base', base, '--head', `${fork.split('/')[0]}:${BRANCH}`, '--title', TITLE, '--body', prBody({ device, files }) + extra);
      report.opened.push({ repo, url, fork, files: files.map((x) => x.path) });
      console.error(`opened ${url}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    report.errors.push({ repo, error: String(e.stderr || e.message || e).slice(0, 400) });
  }
}

fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ applied: APPLY, as: me.login, claimed: claimed.length, planned: report.planned.length, opened: report.opened.length, skipped: report.skipped, errors: report.errors, report: REPORT }, null, 2));
if (report.errors.length) process.exitCode = 1;
